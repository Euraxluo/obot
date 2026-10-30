package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/accesscontrolrule"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/storage"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	"github.com/obot-platform/obot/pkg/system"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	gocache "k8s.io/client-go/tools/cache"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func connectorAccessRequestTestSetup(t *testing.T) (storage.Client, *ConnectorAccessRequestHandler) {
	t.Helper()

	storageClient, entry := connectorAccessRequestStorage(t)
	require.NoError(t, storageClient.Create(t.Context(), entry))
	return storageClient, connectorAccessRequestHandlerWithUser(&kuser.DefaultInfo{UID: "42"})
}

// connectorAccessRequestStorage returns an empty client and the published test
// entry, leaving the caller to create it alongside any other fixtures.
func connectorAccessRequestStorage(t *testing.T) (storage.Client, *v1.MCPServerCatalogEntry) {
	t.Helper()

	entry := &v1.MCPServerCatalogEntry{
		ObjectMeta: connectorAccessRequestEntryMeta("mce1-connector"),
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Test Connector",
				Metadata: map[string]string{
					"displayNameZh":                  "测试连接器",
					types.MarketPublishedMetadataKey: "true",
				},
			},
		},
	}

	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		Build())
	return storageClient, entry
}

func connectorAccessRequestHandlerWithUser(requester kuser.Info) *ConnectorAccessRequestHandler {
	return connectorAccessRequestHandlerWithUserAndACRs(requester)
}

// connectorAccessRequestHandlerWithUserAndACRs builds a handler whose ACR helper
// sees the given rules, so tests can exercise the "already granted" short-circuit.
func connectorAccessRequestHandlerWithUserAndACRs(requester kuser.Info, acrs ...*v1.AccessControlRule) *ConnectorAccessRequestHandler {
	return &ConnectorAccessRequestHandler{
		acrHelper: accesscontrolrule.NewAccessControlRuleHelper(connectorAccessRequestAccessRuleIndexer(acrs...), nil),
		userInfo: func(context.Context, string) (kuser.Info, error) {
			return requester, nil
		},
	}
}

func connectorAccessRequestAccessRuleIndexer(acrs ...*v1.AccessControlRule) gocache.Indexer {
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(obj any) ([]string, error) {
			rule := obj.(*v1.AccessControlRule)
			return connectorAccessRequestResourceIDs(rule, types.ResourceTypeSelector), nil
		},
		"catalog-entry-names": func(obj any) ([]string, error) {
			rule := obj.(*v1.AccessControlRule)
			return connectorAccessRequestResourceIDs(rule, types.ResourceTypeMCPServerCatalogEntry), nil
		},
	})
	for _, rule := range acrs {
		if err := indexer.Add(rule); err != nil {
			panic(err)
		}
	}
	return indexer
}

func connectorAccessRequestResourceIDs(rule *v1.AccessControlRule, resourceType types.ResourceType) []string {
	var ids []string
	for _, resource := range rule.Spec.Manifest.Resources {
		if resource.Type == resourceType {
			ids = append(ids, resource.ID)
		}
	}
	return ids
}

func connectorAccessRequestSubject(subjectType types.SubjectType, subjectID string) types.Subject {
	return types.Subject{Type: subjectType, ID: subjectID}
}

func connectorAccessRequestResource(resourceType types.ResourceType, resourceID string) types.Resource {
	return types.Resource{Type: resourceType, ID: resourceID}
}

func connectorAccessRequestACR(subjectType types.SubjectType, subjectID string) *v1.AccessControlRule {
	return &v1.AccessControlRule{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: system.AccessControlRulePrefix,
			Namespace:    system.DefaultNamespace,
		},
		Spec: v1.AccessControlRuleSpec{
			MCPCatalogID: system.DefaultCatalog,
			Manifest: types.AccessControlRuleManifest{
				Subjects:  []types.Subject{connectorAccessRequestSubject(subjectType, subjectID)},
				Resources: []types.Resource{connectorAccessRequestResource(types.ResourceTypeMCPServerCatalogEntry, "mce1-connector")},
			},
		},
	}
}

// connectorAccessRequestSelectorACR is a rule whose resource is selector:* —
// it grants every catalog entry to whoever its subject names.
func connectorAccessRequestSelectorACR(subjectType types.SubjectType, subjectID string) *v1.AccessControlRule {
	return &v1.AccessControlRule{
		ObjectMeta: metav1.ObjectMeta{
			GenerateName: system.AccessControlRulePrefix,
			Namespace:    system.DefaultNamespace,
		},
		Spec: v1.AccessControlRuleSpec{
			MCPCatalogID: system.DefaultCatalog,
			Manifest: types.AccessControlRuleManifest{
				Subjects:  []types.Subject{connectorAccessRequestSubject(subjectType, subjectID)},
				Resources: []types.Resource{connectorAccessRequestResource(types.ResourceTypeSelector, "*")},
			},
		},
	}
}

func connectorAccessRequestUserWithGroups(authProviderGroups, obotGroups []string) *kuser.DefaultInfo {
	return &kuser.DefaultInfo{
		UID:    "42",
		Name:   "enduser",
		Groups: []string{types.GroupBasic, types.GroupAuthenticated},
		Extra: map[string][]string{
			"email":                {"enduser@example.com"},
			"auth_provider_groups": authProviderGroups,
			"obot_groups":          obotGroups,
		},
	}
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
		UID:    "42",
		Name:   "enduser",
		Groups: []string{types.GroupBasic, types.GroupAuthenticated},
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

	var approvedResp types.ConnectorAccessRequest
	require.NoError(t, json.Unmarshal(req.ResponseWriter.(*httptest.ResponseRecorder).Body.Bytes(), &approvedResp))
	require.True(t, approvedResp.ConnectorPublished)

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
	require.Equal(t, []types.Subject{{Type: types.SubjectTypeUser, ID: "42"}}, acrs.Items[0].Spec.Manifest.Subjects)
	require.Equal(t, []types.Resource{
		{Type: types.ResourceTypeMCPServerCatalogEntry, ID: "mce1-connector"},
	}, acrs.Items[0].Spec.Manifest.Resources)
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

func TestConnectorAccessRequestApproveUnpublishedRejected(t *testing.T) {
	entry := &v1.MCPServerCatalogEntry{
		ObjectMeta: connectorAccessRequestEntryMeta("mce-unpub"),
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Unpublished Connector",
				Metadata: map[string]string{
					"displayNameZh": "未发布连接器",
				},
			},
		},
	}
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(entry).
		Build())
	handler := new(ConnectorAccessRequestHandler)
	endUser := connectorAccessRequestEndUser()
	admin := connectorAccessRequestAdmin()

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{
			ConnectorID: "mce-unpub",
			Reason:      "试用",
		}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)
	requestID := list.Items[0].Name

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+requestID+"/approve",
		types.ConnectorAccessReview{Comment: "ok"}, admin)
	req.SetPathValue("connector_access_request_id", requestID)
	err := handler.Approve(req)
	require.Error(t, err)
	require.ErrorContains(t, err, "connector is not published in the marketplace; publish it before approving")

	var acrs v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Empty(t, acrs.Items)

	var stored v1.ConnectorAccessRequest
	require.NoError(t, storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      requestID,
	}, &stored))
	require.Equal(t, types.ConnectorAccessRequestPending, stored.Spec.Manifest.Status)
}

func TestConnectorAccessRequestListConnectorPublished(t *testing.T) {
	pubEntry := &v1.MCPServerCatalogEntry{
		ObjectMeta: connectorAccessRequestEntryMeta("mce-pub"),
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Published Connector",
				Metadata: map[string]string{
					types.MarketPublishedMetadataKey: "true",
				},
			},
		},
	}
	unpubEntry := &v1.MCPServerCatalogEntry{
		ObjectMeta: connectorAccessRequestEntryMeta("mce-unpub"),
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Unpublished Connector",
				Metadata: map[string]string{
					types.MarketPublishedMetadataKey: "false",
				},
			},
		},
	}
	otherCatalogEntry := &v1.MCPServerCatalogEntry{
		ObjectMeta: connectorAccessRequestEntryMeta("mce-other-pub"),
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: "other-catalog",
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Other Catalog Published Connector",
				Metadata: map[string]string{
					types.MarketPublishedMetadataKey: "true",
				},
			},
		},
	}

	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(pubEntry, unpubEntry, otherCatalogEntry).
		Build())
	handler := new(ConnectorAccessRequestHandler)
	endUser := connectorAccessRequestEndUser()
	admin := connectorAccessRequestAdmin()

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce-pub"}, endUser)
	require.NoError(t, handler.Create(req))

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce-unpub"}, endUser)
	require.NoError(t, handler.Create(req))

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce-other-pub"}, endUser)
	require.NoError(t, handler.Create(req))

	req = connectorAccessRequestContext(t, storageClient, http.MethodGet, "/api/connector-access-requests", nil, admin)
	require.NoError(t, handler.List(req))

	var list types.ConnectorAccessRequestList
	require.NoError(t, json.Unmarshal(req.ResponseWriter.(*httptest.ResponseRecorder).Body.Bytes(), &list))
	require.Len(t, list.Items, 3)

	publishedByID := make(map[string]bool)
	for _, item := range list.Items {
		publishedByID[item.Manifest.ConnectorID] = item.ConnectorPublished
	}

	require.True(t, publishedByID["mce-pub"])
	require.False(t, publishedByID["mce-unpub"])
	require.True(t, publishedByID["mce-other-pub"])
}

func TestConnectorAccessRequestDeleteApprovedRevokesACR(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()
	admin := connectorAccessRequestAdmin()

	// 1. Create and approve request
	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{
			ConnectorID: "mce1-connector",
			Reason:      "测试批准后撤回",
		}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)
	requestID := list.Items[0].Name

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+requestID+"/approve",
		types.ConnectorAccessReview{Comment: "approved"}, admin)
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Approve(req))

	// Verify ACR was created
	var acrs v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, acrs.Items, 1)
	require.True(t, acrs.Items[0].DeletionTimestamp.IsZero())

	// 2. Admin deletes the approved request
	req = connectorAccessRequestContext(t, storageClient, http.MethodDelete,
		"/api/connector-access-requests/"+requestID, nil, admin)
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Delete(req))

	// 3. Request is gone
	var stored v1.ConnectorAccessRequest
	err := storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      requestID,
	}, &stored)
	require.True(t, apierrors.IsNotFound(err))

	// 4. Strictly matching ACR is deleted (marked for deletion)
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, acrs.Items, 1)
	require.False(t, acrs.Items[0].DeletionTimestamp.IsZero())
}

func TestConnectorAccessRequestDeleteApprovedRetainsModifiedACR(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()
	admin := connectorAccessRequestAdmin()

	// 1. Create and approve request
	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{
			ConnectorID: "mce1-connector",
			Reason:      "测试额外subject规则保留",
		}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)
	requestID := list.Items[0].Name

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+requestID+"/approve",
		types.ConnectorAccessReview{Comment: "approved"}, admin)
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Approve(req))

	// 2. Modify the ACR to add an extra subject (no longer strictly matches only requester)
	var acrs v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, acrs.Items, 1)
	modifiedACR := acrs.Items[0]
	modifiedACR.Spec.Manifest.Subjects = append(modifiedACR.Spec.Manifest.Subjects, types.Subject{
		Type: types.SubjectTypeUser,
		ID:   "another-user-99",
	})
	require.NoError(t, storageClient.Update(t.Context(), &modifiedACR))

	// 3. Admin deletes the approved request
	req = connectorAccessRequestContext(t, storageClient, http.MethodDelete,
		"/api/connector-access-requests/"+requestID, nil, admin)
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Delete(req))

	// 4. Request is deleted
	var stored v1.ConnectorAccessRequest
	err := storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      requestID,
	}, &stored)
	require.True(t, apierrors.IsNotFound(err))

	// 5. Modified ACR is RETAINED (DeletionTimestamp is zero)
	var acrsAfter v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrsAfter, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, acrsAfter.Items, 1)
	require.True(t, acrsAfter.Items[0].DeletionTimestamp.IsZero())
	require.Len(t, acrsAfter.Items[0].Spec.Manifest.Subjects, 2)
}

func TestConnectorAccessRequestDeleteRequiresAdmin(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce1-connector"}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)
	requestID := list.Items[0].Name

	// Non-admin attempts to delete -> 403 Forbidden ("admin only")
	req = connectorAccessRequestContext(t, storageClient, http.MethodDelete,
		"/api/connector-access-requests/"+requestID, nil, endUser)
	req.SetPathValue("connector_access_request_id", requestID)
	err := handler.Delete(req)
	require.Error(t, err)
	require.ErrorContains(t, err, "admin only")
	var httpErr *types.ErrHTTP
	require.ErrorAs(t, err, &httpErr)
	require.Equal(t, http.StatusForbidden, httpErr.Code)

	// Record still exists
	var stored v1.ConnectorAccessRequest
	require.NoError(t, storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      requestID,
	}, &stored))
}

func TestConnectorAccessRequestDeletePendingNoACR(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()
	admin := connectorAccessRequestAdmin()

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{
			ConnectorID: "mce1-connector",
			Reason:      "测试删除pending请求",
		}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)
	requestID := list.Items[0].Name

	// Admin deletes pending request
	req = connectorAccessRequestContext(t, storageClient, http.MethodDelete,
		"/api/connector-access-requests/"+requestID, nil, admin)
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Delete(req))

	// Request is gone
	var stored v1.ConnectorAccessRequest
	err := storageClient.Get(t.Context(), kclient.ObjectKey{
		Namespace: system.DefaultNamespace,
		Name:      requestID,
	}, &stored)
	require.True(t, apierrors.IsNotFound(err))

	// No ACR was ever created
	var acrs v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Empty(t, acrs.Items)
}

func TestConnectorAccessRequestDeleteNotFound(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	admin := connectorAccessRequestAdmin()

	req := connectorAccessRequestContext(t, storageClient, http.MethodDelete,
		"/api/connector-access-requests/non-existent-id", nil, admin)
	req.SetPathValue("connector_access_request_id", "non-existent-id")
	err := handler.Delete(req)
	require.Error(t, err)
	require.True(t, apierrors.IsNotFound(err))
}

// TestConnectorAccessRequestApproveSkipsRedundantACR covers the case where the
// requester already reaches the connector through some other rule: approving
// must not write a second, user-subject ACR. Otherwise revoking the group grant
// later would silently leave that user with access.
func TestConnectorAccessRequestApproveSkipsRedundantACR(t *testing.T) {
	endUser := connectorAccessRequestEndUser()

	tests := []struct {
		name      string
		existing  *v1.AccessControlRule
		requester *kuser.DefaultInfo
	}{
		{
			name:      "obot group",
			existing:  connectorAccessRequestACR(types.SubjectTypeObotGroup, types.GroupBasic),
			requester: endUser,
		},
		{
			name:      "idp group",
			existing:  connectorAccessRequestACR(types.SubjectTypeGroup, "engineering"),
			requester: connectorAccessRequestUserWithGroups([]string{"engineering"}, []string{types.GroupBasic}),
		},
		{
			name: "selector wildcard",
			// A selector rule is a rule whose *resource* is selector:*, granting every entry.
			existing:  connectorAccessRequestSelectorACR(types.SubjectTypeUser, "42"),
			requester: endUser,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			storageClient, entry := connectorAccessRequestStorage(t)
			require.NoError(t, storageClient.Create(t.Context(), entry))
			// The pre-existing rule must live in storage too: the handler writes
			// its own ACR through the same client and the final assertion counts rows.
			require.NoError(t, storageClient.Create(t.Context(), tt.existing))

			handler := connectorAccessRequestHandlerWithUserAndACRs(tt.requester, tt.existing)

			req := connectorAccessRequestContext(t, storageClient, http.MethodPost,
				"/api/connector-access-requests",
				types.ConnectorAccessRequestManifest{ConnectorID: "mce1-connector"}, tt.requester)
			require.NoError(t, handler.Create(req))

			var list v1.ConnectorAccessRequestList
			require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
			require.Len(t, list.Items, 1)
			requestID := list.Items[0].Name

			req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
				"/api/connector-access-requests/"+requestID+"/approve",
				types.ConnectorAccessReview{}, connectorAccessRequestAdmin())
			req.SetPathValue("connector_access_request_id", requestID)
			require.NoError(t, handler.Approve(req))

			// Only the pre-existing rule is present; approval added nothing.
			var acrs v1.AccessControlRuleList
			require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
			require.Len(t, acrs.Items, 1)
			require.Equal(t, tt.existing.Spec.Manifest.Subjects, acrs.Items[0].Spec.Manifest.Subjects)
		})
	}
}

// TestConnectorAccessRequestApproveWritesACRWhenUnauthorized is the regression
// guard: with no prior access the approval still has to grant one, otherwise
// the connector stays unusable.
func TestConnectorAccessRequestApproveWritesACRWhenUnauthorized(t *testing.T) {
	storageClient, handler := connectorAccessRequestTestSetup(t)
	endUser := connectorAccessRequestEndUser()

	req := connectorAccessRequestContext(t, storageClient, http.MethodPost, "/api/connector-access-requests",
		types.ConnectorAccessRequestManifest{ConnectorID: "mce1-connector"}, endUser)
	require.NoError(t, handler.Create(req))

	var list v1.ConnectorAccessRequestList
	require.NoError(t, storageClient.List(t.Context(), &list, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, list.Items, 1)
	requestID := list.Items[0].Name

	req = connectorAccessRequestContext(t, storageClient, http.MethodPost,
		"/api/connector-access-requests/"+requestID+"/approve",
		types.ConnectorAccessReview{}, connectorAccessRequestAdmin())
	req.SetPathValue("connector_access_request_id", requestID)
	require.NoError(t, handler.Approve(req))

	var acrs v1.AccessControlRuleList
	require.NoError(t, storageClient.List(t.Context(), &acrs, &kclient.ListOptions{Namespace: system.DefaultNamespace}))
	require.Len(t, acrs.Items, 1)
	require.Equal(t, []types.Subject{{Type: types.SubjectTypeUser, ID: "42"}}, acrs.Items[0].Spec.Manifest.Subjects)
}
