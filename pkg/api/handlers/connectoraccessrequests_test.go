package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/storage"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	"github.com/obot-platform/obot/pkg/system"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func connectorAccessRequestTestSetup(t *testing.T) (storage.Client, *ConnectorAccessRequestHandler) {
	t.Helper()

	entry := &v1.MCPServerCatalogEntry{
		ObjectMeta: connectorAccessRequestEntryMeta("mce1-connector"),
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Test Connector",
				Metadata: map[string]string{
					"displayNameZh": "测试连接器",
				},
			},
		},
	}

	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(entry).
		Build())
	return storageClient, new(ConnectorAccessRequestHandler)
}

func connectorAccessRequestEntryMeta(name string) (meta metav1.ObjectMeta) {
	meta.Name = name
	meta.Namespace = system.DefaultNamespace
	return meta
}

func connectorAccessRequestContext(t *testing.T, storageClient storage.Client, method, target string, body any, u kuser.Info) api.Context {
	t.Helper()

	var reader *bytes.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(encoded)
	} else {
		reader = bytes.NewReader(nil)
	}

	request := httptest.NewRequest(method, target, reader)
	return api.Context{
		ResponseWriter: httptest.NewRecorder(),
		Request:        request,
		Storage:        storageClient,
		User:           u,
	}
}

func connectorAccessRequestEndUser() *kuser.DefaultInfo {
	return &kuser.DefaultInfo{
		UID:      "42",
		Name:     "enduser",
		Groups:   []string{types.GroupBasic, types.GroupAuthenticated},
		Extra: map[string][]string{
			"email":       {"enduser@example.com"},
			"obot_groups": {types.GroupBasic, types.GroupAuthenticated},
		},
	}
}

func connectorAccessRequestAdmin() *kuser.DefaultInfo {
	return &kuser.DefaultInfo{
		UID:    "7",
		Name:   "admin",
		Groups: []string{types.GroupAdmin, types.GroupAuthenticated},
		Extra: map[string][]string{
			"obot_groups": {types.GroupAdmin, types.GroupBasic},
		},
	}
}

func TestConnectorAccessRequestCreateApproveFlow(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()

	// The end user files a request for the connector.
	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{
			ConnectorID: "mce1-connector",
			Reason:      "需要查询数据",
		}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)

	created := list.Items[0]
	require.Equal(t, types.ConnectorAccessRequestPending, created.Spec.Manifest.Status)
	require.Equal(t, "42", created.Spec.Manifest.RequesterUserID)
	require.Equal(t, "enduser", created.Spec.Manifest.RequesterUsername)
	require.Equal(t, "enduser@example.com", created.Spec.Manifest.RequesterEmail)
	require.Equal(t, "测试连接器", created.Spec.Manifest.ConnectorName)
	require.Equal(t, system.DefaultCatalog, created.Spec.Manifest.MCPCatalogID)

	// A duplicate while pending is refused.
	req = connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce1-connector"}, endUser)
	require.ErrorContains(t, handler.Create(req), "already pending")

	// An admin approves; the request flips and a user-subject ACR is written.
	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+created.Name+"/approve",
		types.ConnectorAccessReview{Comment: "ok"}, connectorAccessRequestAdmin())
	req.SetPathValue("connector_access_request_id", created.Name)
	require.NoError(t, handler.Approve(req))

	var approved v1.ConnectorAccessRequest
	require.NoError(t, storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      created.Name,
	}, &approved))
	require.Equal(t, types.ConnectorAccessRequestApproved, approved.Spec.Manifest.Status)
	require.Equal(t, "7", approved.Spec.Manifest.ReviewerUserID)
	require.Equal(t, "ok", approved.Spec.Manifest.ReviewComment)

	var acrs v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, acrs.Items, 1)
	require.True(t, acrGrantsConnectorToUser(acrs.Items[0].Spec.Manifest, "mce1-connector", "42"))
}

func TestConnectorAccessRequestRejectRequiresAdmin(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce1-connector"}, connectorAccessRequestEndUser())
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	requestID := list.Items[0].Name

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+requestID+"/reject",
		types.ConnectorAccessReview{Comment: "不需要"}, connectorAccessRequestEndUser())
	req.SetPathValue("connector_access_request_id", requestID)
	require.ErrorContains(t, handler.Reject(req), "admin only")

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+requestID+"/reject",
		types.ConnectorAccessReview{Comment: "不需要"}, connectorAccessRequestAdmin())
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Reject(req))

	var rejected v1.ConnectorAccessRequest
	require.NoError(t, storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      requestID,
	}, &rejected))
	require.Equal(t, types.ConnectorAccessRequestRejected, rejected.Spec.Manifest.Status)
	require.Equal(t, "不需要", rejected.Spec.Manifest.ReviewComment)
}

func TestConnectorAccessRequestListScopedToRequester(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()
	admin := connectorAccessRequestAdmin()

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce1-connector"}, endUser)
	require.NoError(t, handler.Create(req))

	// The admin sees the request; the end user only sees their own.
	req = connectorAccessRequestContext(t, storageClient, http.MethodGet, "/api/connector-access-requests", nil, admin)
	require.NoError(t, handler.List(req))

	req = connectorAccessRequestContext(t, storageClient, http.MethodGet, "/api/connector-access-requests?status=pending", nil, endUser)
	require.NoError(t, handler.List(req))

	otherUser := connectorAccessRequestEndUser()
	otherUser.UID = "43"
	req = connectorAccessRequestContext(t, storageClient, http.MethodGet, "/api/connector-access-requests", nil, otherUser)
	require.NoError(t, handler.List(req))
}

func TestIsBasicOnlyUser(t *testing.T) {
	tests := []struct {
		name       string
		obotGroups []string
		want       bool
	}{
		{
			name:       "basic only",
			obotGroups: []string{types.GroupBasic, types.GroupAuthenticated},
			want:       true,
		},
		{
			name:       "admin",
			obotGroups: []string{types.GroupAdmin, types.GroupBasic},
			want:       false,
		},
		{
			name:       "power user",
			obotGroups: []string{types.GroupPowerUser, types.GroupBasic},
			want:       false,
		},
		{
			name:       "no role groups",
			obotGroups: nil,
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			u := &kuser.DefaultInfo{
				UID:  "1",
				Name: "user",
				Extra: map[string][]string{
					"obot_groups": tt.obotGroups,
				},
			}
			require.Equal(t, tt.want, isBasicOnlyUser(u))
		})
	}
}
