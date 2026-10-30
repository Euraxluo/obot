package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/accesscontrolrule"
	"github.com/obot-platform/obot/pkg/api"
	gatewaytypes "github.com/obot-platform/obot/pkg/gateway/types"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	gocache "k8s.io/client-go/tools/cache"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

func vmcpGateTestAccessRuleIndexer(acrs []*v1.AccessControlRule) gocache.Indexer {
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(obj any) ([]string, error) {
			rule := obj.(*v1.AccessControlRule)
			var ids []string
			for _, r := range rule.Spec.Manifest.Resources {
				if r.Type == types.ResourceTypeSelector {
					ids = append(ids, r.ID)
				}
			}
			return ids, nil
		},
		"catalog-entry-names": func(obj any) ([]string, error) {
			rule := obj.(*v1.AccessControlRule)
			var ids []string
			for _, r := range rule.Spec.Manifest.Resources {
				if r.Type == types.ResourceTypeMCPServerCatalogEntry {
					ids = append(ids, r.ID)
				}
			}
			return ids, nil
		},
	})
	for _, rule := range acrs {
		if err := indexer.Add(rule); err != nil {
			panic(err)
		}
	}
	return indexer
}

func TestVMCPBasicUserConnectorAccessGate(t *testing.T) {
	entry := &v1.MCPServerCatalogEntry{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-connector",
			Namespace: system.DefaultNamespace,
		},
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Test Connector",
			},
		},
	}

	basicUser := &kuser.DefaultInfo{
		UID:  "basic-1",
		Name: "basic-user",
		Extra: map[string][]string{
			"obot_groups": {types.GroupBasic},
		},
	}

	basicUserWithIdP := &kuser.DefaultInfo{
		UID:  "basic-idp",
		Name: "basic-idp-user",
		Extra: map[string][]string{
			"obot_groups":          {types.GroupBasic},
			"auth_provider_groups": {"engineering"},
		},
	}

	adminUser := &kuser.DefaultInfo{
		UID:  "admin-1",
		Name: "admin-user",
		Extra: map[string][]string{
			"obot_groups": {types.GroupAdmin, types.GroupBasic},
		},
	}

	tests := []struct {
		name        string
		user        kuser.Info
		ownerID     string
		acrs        []*v1.AccessControlRule
		requests    []*v1.ConnectorAccessRequest
		wantErr     bool
		errContains string
	}{
		{
			name:    "a) basic user granted via obotGroup is allowed",
			user:    basicUser,
			ownerID: basicUser.UID,
			acrs: []*v1.AccessControlRule{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "acr-obotgroup",
						Namespace: system.DefaultNamespace,
					},
					Spec: v1.AccessControlRuleSpec{
						MCPCatalogID: system.DefaultCatalog,
						Manifest: types.AccessControlRuleManifest{
							Subjects: []types.Subject{
								{
									Type: types.SubjectTypeObotGroup,
									ID:   types.GroupBasic,
								},
							},
							Resources: []types.Resource{
								{
									Type: types.ResourceTypeMCPServerCatalogEntry,
									ID:   entry.Name,
								},
							},
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name:    "b) basic user granted via IdP group is allowed",
			user:    basicUserWithIdP,
			ownerID: basicUserWithIdP.UID,
			acrs: []*v1.AccessControlRule{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "acr-group",
						Namespace: system.DefaultNamespace,
					},
					Spec: v1.AccessControlRuleSpec{
						MCPCatalogID: system.DefaultCatalog,
						Manifest: types.AccessControlRuleManifest{
							Subjects: []types.Subject{
								{
									Type: types.SubjectTypeGroup,
									ID:   "engineering",
								},
							},
							Resources: []types.Resource{
								{
									Type: types.ResourceTypeMCPServerCatalogEntry,
									ID:   entry.Name,
								},
							},
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name:    "c) basic user granted via wildcard selector subject is allowed",
			user:    basicUser,
			ownerID: basicUser.UID,
			acrs: []*v1.AccessControlRule{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "acr-wildcard",
						Namespace: system.DefaultNamespace,
					},
					Spec: v1.AccessControlRuleSpec{
						MCPCatalogID: system.DefaultCatalog,
						Manifest: types.AccessControlRuleManifest{
							Subjects: []types.Subject{
								{
									Type: types.SubjectTypeSelector,
									ID:   "*",
								},
							},
							Resources: []types.Resource{
								{
									Type: types.ResourceTypeMCPServerCatalogEntry,
									ID:   entry.Name,
								},
							},
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name:    "d) basic user granted via user-subject ACR is allowed (regression)",
			user:    basicUser,
			ownerID: basicUser.UID,
			acrs: []*v1.AccessControlRule{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "acr-user",
						Namespace: system.DefaultNamespace,
					},
					Spec: v1.AccessControlRuleSpec{
						MCPCatalogID: system.DefaultCatalog,
						Manifest: types.AccessControlRuleManifest{
							Subjects: []types.Subject{
								{
									Type: types.SubjectTypeUser,
									ID:   basicUser.UID,
								},
							},
							Resources: []types.Resource{
								{
									Type: types.ResourceTypeMCPServerCatalogEntry,
									ID:   entry.Name,
								},
							},
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name:    "e) basic user with approved request but no ACR is allowed (regression)",
			user:    basicUser,
			ownerID: basicUser.UID,
			requests: []*v1.ConnectorAccessRequest{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "req-approved",
						Namespace: system.DefaultNamespace,
					},
					Spec: v1.ConnectorAccessRequestSpec{
						Manifest: types.ConnectorAccessRequestManifest{
							RequesterUserID: basicUser.UID,
							ConnectorID:     entry.Name,
							Status:          types.ConnectorAccessRequestApproved,
						},
					},
				},
			},
			wantErr: false,
		},
		{
			name:        "f) basic user with no ACR grant and no request is forbidden (regression)",
			user:        basicUser,
			ownerID:     basicUser.UID,
			wantErr:     true,
			errContains: `connector "Test Connector" requires an approved access request`,
		},
		{
			name:    "f-2) basic user with pending request is still forbidden",
			user:    basicUser,
			ownerID: basicUser.UID,
			requests: []*v1.ConnectorAccessRequest{
				{
					ObjectMeta: metav1.ObjectMeta{
						Name:      "req-pending",
						Namespace: system.DefaultNamespace,
					},
					Spec: v1.ConnectorAccessRequestSpec{
						Manifest: types.ConnectorAccessRequestManifest{
							RequesterUserID: basicUser.UID,
							ConnectorID:     entry.Name,
							Status:          types.ConnectorAccessRequestPending,
						},
					},
				},
			},
			wantErr:     true,
			errContains: `connector "Test Connector" requires an approved access request`,
		},
		{
			name:    "g) non-basic user with no grants is allowed (regression)",
			user:    adminUser,
			ownerID: adminUser.UID,
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var storageObjs []kclient.Object
			for _, reqObj := range tt.requests {
				storageObjs = append(storageObjs, reqObj)
			}
			storage := newVMCPTestStorage(storageObjs...)

			indexer := vmcpGateTestAccessRuleIndexer(tt.acrs)
			helper := accesscontrolrule.NewAccessControlRuleHelper(indexer, storage)
			h := NewVMCPHandler(helper, "", "")

			req := api.Context{
				Request: httptest.NewRequest(http.MethodPost, "/api/vmcps", nil),
				Storage: storage,
				User:    tt.user,
			}

			err := h.requireConnectorApproval(req, tt.ownerID, entry)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					require.Contains(t, err.Error(), tt.errContains)
				}
				var httpErr *types.ErrHTTP
				require.True(t, errors.As(err, &httpErr))
				require.Equal(t, http.StatusForbidden, httpErr.Code)
			} else {
				require.NoError(t, err)
			}
		})
	}
}

func TestVMCPRequireConnectorApprovalAdminActingForBasicOwner(t *testing.T) {
	entry := &v1.MCPServerCatalogEntry{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "test-connector",
			Namespace: system.DefaultNamespace,
		},
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name: "Test Connector",
			},
		},
	}

	gatewayClient, db := newHandlerTestGatewayWithDB(t)
	dbBasicUser := &gatewaytypes.User{Username: "basic-owner", Email: "basic-owner@example.com", Role: types.RoleBasic}
	require.NoError(t, db.Create(dbBasicUser).Error)
	basicOwnerID := strconv.Itoa(int(dbBasicUser.ID))

	adminUser := &kuser.DefaultInfo{
		UID:  "admin-999",
		Name: "admin-actor",
		Extra: map[string][]string{
			"obot_groups": {types.GroupAdmin},
		},
	}

	t.Run("basic owner granted via obotGroup allows admin edit", func(t *testing.T) {
		acr := &v1.AccessControlRule{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "acr-obotgroup",
				Namespace: system.DefaultNamespace,
			},
			Spec: v1.AccessControlRuleSpec{
				MCPCatalogID: system.DefaultCatalog,
				Manifest: types.AccessControlRuleManifest{
					Subjects: []types.Subject{
						{
							Type: types.SubjectTypeObotGroup,
							ID:   types.GroupBasic,
						},
					},
					Resources: []types.Resource{
						{
							Type: types.ResourceTypeMCPServerCatalogEntry,
							ID:   entry.Name,
						},
					},
				},
			},
		}

		storage := newVMCPTestStorage()
		indexer := vmcpGateTestAccessRuleIndexer([]*v1.AccessControlRule{acr})
		h := NewVMCPHandler(accesscontrolrule.NewAccessControlRuleHelper(indexer, storage), "", "")

		req := api.Context{
			Request:       httptest.NewRequest(http.MethodPost, "/api/vmcps", nil),
			Storage:       storage,
			GatewayClient: gatewayClient,
			User:          adminUser,
		}

		err := h.requireConnectorApproval(req, basicOwnerID, entry)
		require.NoError(t, err)
	})

	t.Run("basic owner without grants forbids admin edit even if admin is calling", func(t *testing.T) {
		storage := newVMCPTestStorage()
		indexer := vmcpGateTestAccessRuleIndexer(nil)
		h := NewVMCPHandler(accesscontrolrule.NewAccessControlRuleHelper(indexer, storage), "", "")

		req := api.Context{
			Request:       httptest.NewRequest(http.MethodPost, "/api/vmcps", nil),
			Storage:       storage,
			GatewayClient: gatewayClient,
			User:          adminUser,
		}

		err := h.requireConnectorApproval(req, basicOwnerID, entry)
		require.Error(t, err)
		var httpErr *types.ErrHTTP
		require.True(t, errors.As(err, &httpErr))
		require.Equal(t, http.StatusForbidden, httpErr.Code)
		require.Contains(t, err.Error(), `connector "Test Connector" requires an approved access request`)
	})
}

func TestVMCPCreateBasicUserConnectorAccessGate(t *testing.T) {
	entry := &v1.MCPServerCatalogEntry{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "default-baixiao-ai-dc2cd147",
			Namespace: system.DefaultNamespace,
		},
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name:    "Baixiao AI",
				Runtime: types.RuntimeRemote,
			},
		},
	}

	basicUser := &kuser.DefaultInfo{
		UID:  "user2",
		Name: "user2",
		Extra: map[string][]string{
			"obot_groups": {types.GroupBasic},
		},
	}

	manifest := types.VMCPManifest{
		DisplayName: "My Personal vMCP",
		Components: []types.VMCPComponent{
			{
				Name:                    "baixiao",
				MCPCatalogID:            system.DefaultCatalog,
				MCPServerCatalogEntryID: entry.Name,
			},
		},
	}

	t.Run("basic user creates personal vMCP with obotGroup ACR succeeds", func(t *testing.T) {
		acr := &v1.AccessControlRule{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "acr-group-grant",
				Namespace: system.DefaultNamespace,
			},
			Spec: v1.AccessControlRuleSpec{
				MCPCatalogID: system.DefaultCatalog,
				Manifest: types.AccessControlRuleManifest{
					Subjects: []types.Subject{
						{
							Type: types.SubjectTypeObotGroup,
							ID:   types.GroupBasic,
						},
					},
					Resources: []types.Resource{
						{
							Type: types.ResourceTypeMCPServerCatalogEntry,
							ID:   entry.Name,
						},
					},
				},
			},
		}

		storage := newVMCPTestStorage(entry)
		indexer := vmcpGateTestAccessRuleIndexer([]*v1.AccessControlRule{acr})
		h := NewVMCPHandler(accesscontrolrule.NewAccessControlRuleHelper(indexer, storage), "", "")
		gatewayClient := newHandlerTestGateway(t)

		created := callVMCPCreate(t, storage, gatewayClient, h, manifest, basicUser)
		require.Equal(t, "user2", created.UserID)
		require.Len(t, created.Components, 1)
		require.Equal(t, entry.Name, created.Components[0].MCPServerCatalogEntryID)
	})

	t.Run("basic user creates personal vMCP without ACR or request fails with 403", func(t *testing.T) {
		storage := newVMCPTestStorage(entry)
		indexer := vmcpGateTestAccessRuleIndexer(nil)
		h := NewVMCPHandler(accesscontrolrule.NewAccessControlRuleHelper(indexer, storage), "", "")
		gatewayClient := newHandlerTestGateway(t)

		body, err := json.Marshal(manifest)
		require.NoError(t, err)

		recorder := httptest.NewRecorder()
		err = h.Create(api.Context{
			ResponseWriter: recorder,
			Request:        httptest.NewRequest(http.MethodPost, "/api/vmcps", bytes.NewReader(body)),
			Storage:        storage,
			GatewayClient:  gatewayClient,
			User:           basicUser,
		})
		require.Error(t, err)
		var httpErr *types.ErrHTTP
		require.True(t, errors.As(err, &httpErr))
		require.Equal(t, http.StatusForbidden, httpErr.Code)
	})
}
