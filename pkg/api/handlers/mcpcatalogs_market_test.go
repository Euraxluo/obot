package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/mcp"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

func TestUpdateCatalogEntryMarketPublication(t *testing.T) {
	for _, test := range []struct {
		name        string
		editable    bool
		sourceURL   string
		published   string
		description string
		wantErr     string
	}{
		{
			name:      "admin publishes editable entry",
			editable:  true,
			published: "true",
		},
		{
			name:      "admin unpublishes editable entry",
			editable:  true,
			published: "false",
		},
		{
			name:      "admin publishes git-managed entry",
			sourceURL: "https://github.com/obot-platform/mcp-catalog",
			published: "true",
		},
		{
			name:        "git-managed entry rejects other changes",
			sourceURL:   "https://github.com/obot-platform/mcp-catalog",
			published:   "true",
			description: "changed",
			wantErr:     "entry is not editable",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			entry := &v1.MCPServerCatalogEntry{
				Name:      "entry-market",
				Namespace: system.DefaultNamespace,
				Spec: v1.MCPServerCatalogEntrySpec{
					MCPCatalogName: "catalog-1",
					Editable:       test.editable,
					SourceURL:      test.sourceURL,
					Manifest: types.MCPServerCatalogEntryManifest{
						Name:        "Market Entry",
						Runtime:     types.RuntimeNPX,
						NPXConfig:   &types.NPXRuntimeConfig{Package: "test-server"},
						Description: "original",
					},
				},
			}
			storage := newFakeStorage(t,
				&v1.MCPCatalog{Name: "catalog-1", Namespace: system.DefaultNamespace},
				entry,
			)
			gatewayClient := newEnforcementTestGatewayClient(t)
			handler := &MCPCatalogHandler{mcpBackend: "docker", sessionManager: &mcp.SessionManager{}}

			manifest := *entry.Spec.Manifest.DeepCopy()
			manifest.Metadata = map[string]string{types.MarketPublishedMetadataKey: test.published}
			if test.description != "" {
				manifest.Description = test.description
			}
			req, recorder := catalogEntryRequest(t, storage, gatewayClient, http.MethodPut, "/api/mcp-catalogs/catalog-1/entries/entry-market", manifest, map[string]string{
				"catalog_id": "catalog-1",
				"entry_id":   "entry-market",
			})

			err := handler.UpdateEntry(req)
			if test.wantErr != "" {
				require.ErrorContains(t, err, test.wantErr)
				return
			}
			require.NoError(t, err)
			require.Equal(t, http.StatusOK, recorder.Code)

			var updated v1.MCPServerCatalogEntry
			require.NoError(t, storage.Get(t.Context(), kclient.ObjectKeyFromObject(entry), &updated))
			assert.Equal(t, test.published, updated.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey])
			assert.Equal(t, "original", updated.Spec.Manifest.Description)
		})
	}
}

func TestUpdateCatalogEntryPreservesMarketPublicationWhenOmitted(t *testing.T) {
	entry := &v1.MCPServerCatalogEntry{
		Name:      "entry-market",
		Namespace: system.DefaultNamespace,
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: "catalog-1",
			Editable:       true,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name:      "Market Entry",
				Runtime:   types.RuntimeNPX,
				NPXConfig: &types.NPXRuntimeConfig{Package: "test-server"},
				Metadata: map[string]string{
					types.MarketPublishedMetadataKey: "true",
					"categories":                     "developer-tools",
				},
			},
		},
	}
	storage := newFakeStorage(t,
		&v1.MCPCatalog{Name: "catalog-1", Namespace: system.DefaultNamespace},
		entry,
	)
	handler := &MCPCatalogHandler{mcpBackend: "docker", sessionManager: &mcp.SessionManager{}}

	manifest := *entry.Spec.Manifest.DeepCopy()
	manifest.Metadata = map[string]string{"categories": "developer-tools"}
	manifest.Description = "updated"
	req, _ := catalogEntryRequest(t, storage, newEnforcementTestGatewayClient(t), http.MethodPut, "/api/mcp-catalogs/catalog-1/entries/entry-market", manifest, map[string]string{
		"catalog_id": "catalog-1",
		"entry_id":   "entry-market",
	})

	require.NoError(t, handler.UpdateEntry(req))

	var updated v1.MCPServerCatalogEntry
	require.NoError(t, storage.Get(t.Context(), kclient.ObjectKeyFromObject(entry), &updated))
	assert.Equal(t, "true", updated.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey])
	assert.Equal(t, "updated", updated.Spec.Manifest.Description)
}

func TestUpdateCatalogEntryRejectsNonAdminMarketPublicationChange(t *testing.T) {
	entry := &v1.MCPServerCatalogEntry{
		Name:      "entry-market",
		Namespace: system.DefaultNamespace,
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: "catalog-1",
			Editable:       true,
			Manifest: types.MCPServerCatalogEntryManifest{
				Name:      "Market Entry",
				Runtime:   types.RuntimeNPX,
				NPXConfig: &types.NPXRuntimeConfig{Package: "test-server"},
				Metadata:  map[string]string{types.MarketPublishedMetadataKey: "false"},
			},
		},
	}
	storage := newFakeStorage(t,
		&v1.MCPCatalog{Name: "catalog-1", Namespace: system.DefaultNamespace},
		entry,
	)
	handler := &MCPCatalogHandler{mcpBackend: "docker", sessionManager: &mcp.SessionManager{}}

	manifest := *entry.Spec.Manifest.DeepCopy()
	manifest.Metadata = map[string]string{types.MarketPublishedMetadataKey: "true"}
	body, err := json.Marshal(manifest)
	require.NoError(t, err)
	request := httptest.NewRequest(http.MethodPut, "/api/mcp-catalogs/catalog-1/entries/entry-market", bytes.NewReader(body))
	request.SetPathValue("catalog_id", "catalog-1")
	request.SetPathValue("entry_id", "entry-market")
	recorder := httptest.NewRecorder()

	err = handler.UpdateEntry(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storage,
		GatewayClient:  newEnforcementTestGatewayClient(t),
		User: &kuser.DefaultInfo{
			Name:   "power-user",
			UID:    "power-user",
			Groups: []string{types.GroupPowerUser, types.GroupAuthenticated},
		},
	})
	require.ErrorContains(t, err, "only admins can change marketPublished")
}
