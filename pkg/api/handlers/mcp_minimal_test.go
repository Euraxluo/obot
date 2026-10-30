package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/accesscontrolrule"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/storage"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	"github.com/obot-platform/obot/pkg/system"
	"github.com/stretchr/testify/require"
	kuser "k8s.io/apiserver/pkg/authentication/user"
	gocache "k8s.io/client-go/tools/cache"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

func TestListEntriesFromAllSourcesMinimal(t *testing.T) {
	entry := minimalResponseTestEntry()
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&entry).
		Build())
	request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries?all=true&minimal=true", nil)
	recorder := httptest.NewRecorder()

	err := (&MCPHandler{serverURL: "https://example.com"}).ListEntriesFromAllSources(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "admin",
			UID:    "admin",
			Groups: []string{types.GroupAdmin, types.GroupAuthenticated},
		},
	})
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, recorder.Code)

	var response types.MCPServerCatalogEntryList
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Items, 1)
	manifest := response.Items[0].Manifest
	require.Equal(t, map[string]string{"category": "developer-tools"}, manifest.Metadata)
	require.Equal(t, "test-entry-key", manifest.EntryKey)
	require.Empty(t, manifest.Description)
	require.Empty(t, manifest.ToolPreview)
	require.Equal(t, "Upgrade note", manifest.UpgradeNote)
	require.Empty(t, manifest.RepoURL)
	require.Equal(t, "https://example.com/mcp", manifest.RemoteConfig.FixedURL)
	require.Equal(t, "Test Entry", manifest.Name)
	require.Equal(t, "Short description", manifest.ShortDescription)
	require.Equal(t, "https://example.com/icon.svg", manifest.Icon)
	require.Equal(t, types.RuntimeRemote, manifest.Runtime)

	manifestJSON, err := json.Marshal(manifest)
	require.NoError(t, err)
	require.JSONEq(t, `{
		"metadata": {"category": "developer-tools"},
		"entryKey": "test-entry-key",
		"name": "Test Entry",
		"shortDescription": "Short description",
		"description": "",
		"icon": "https://example.com/icon.svg",
		"runtime": "remote",
		"remoteConfig": {"fixedURL": "https://example.com/mcp"},
		"upgradeNote": "Upgrade note"
	}`, string(manifestJSON))
}

func TestMinimalCatalogEntryPreservesLaunchConfiguration(t *testing.T) {
	entry := minimalResponseTestEntry()
	entry.Spec.Manifest.UVXConfig = &types.UVXRuntimeConfig{Package: "python-package"}
	entry.Spec.Manifest.NPXConfig = &types.NPXRuntimeConfig{Package: "node-package"}
	entry.Spec.Manifest.ContainerizedConfig = &types.ContainerizedRuntimeConfig{Image: "example/image", Port: 8080, Path: "/mcp"}
	entry.Spec.Manifest.Config = []types.MCPConfig{{
		Name:  "Token",
		Key:   "TOKEN",
		Usage: types.Env,
	}}
	entry.Spec.Manifest.Resources = &types.MCPResourceRequirements{}

	expected := entry.Spec.Manifest
	expected.Description = ""
	expected.ToolPreview = nil
	expected.RepoURL = ""

	actual := convertMCPServerCatalogEntryForList(entry, "", "", true, false)
	require.Equal(t, expected, actual.Manifest)
}

func TestListEntriesFromAllSourcesFullByDefault(t *testing.T) {
	entry := minimalResponseTestEntry()
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&entry).
		Build())
	request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries?all=true", nil)
	recorder := httptest.NewRecorder()

	err := (&MCPHandler{serverURL: "https://example.com"}).ListEntriesFromAllSources(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "admin",
			UID:    "admin",
			Groups: []string{types.GroupAdmin, types.GroupAuthenticated},
		},
	})
	require.NoError(t, err)

	var response types.MCPServerCatalogEntryList
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Items, 1)
	require.Equal(t, "Full description", response.Items[0].Manifest.Description)
	require.Len(t, response.Items[0].Manifest.ToolPreview, 1)
	require.Equal(t, "Upgrade note", response.Items[0].Manifest.UpgradeNote)
	require.Equal(t, "https://example.com/repo", response.Items[0].Manifest.RepoURL)
	require.Equal(t, "https://example.com/mcp", response.Items[0].Manifest.RemoteConfig.FixedURL)
}

func TestListEntriesFromAllSourcesMarketOpenSkipsACRVisibility(t *testing.T) {
	entry := minimalResponseTestEntry()
	entry.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey] = "true"
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&entry).
		Build())
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(any) ([]string, error) {
			return nil, nil
		},
		"catalog-entry-names": func(any) ([]string, error) {
			return nil, nil
		},
	})
	request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries", nil)
	recorder := httptest.NewRecorder()

	err := (&MCPHandler{
		serverURL: "https://example.com",
		acrHelper: accesscontrolrule.NewAccessControlRuleHelper(indexer, nil),
	}).ListEntriesFromAllSources(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "basic",
			UID:    "1",
			Groups: []string{types.GroupBasic, types.GroupAuthenticated},
		},
	})
	require.NoError(t, err)

	var response types.MCPServerCatalogEntryList
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Empty(t, response.Items)

	t.Setenv("OBOT_MARKET_OPEN", "true")
	recorder = httptest.NewRecorder()
	err = (&MCPHandler{
		serverURL: "https://example.com",
		acrHelper: accesscontrolrule.NewAccessControlRuleHelper(indexer, nil),
	}).ListEntriesFromAllSources(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "basic",
			UID:    "1",
			Groups: []string{types.GroupBasic, types.GroupAuthenticated},
		},
	})
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Items, 1)
}

func TestListEntriesFromAllSourcesMarketOpenRequiresPublication(t *testing.T) {
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(any) ([]string, error) {
			return nil, nil
		},
		"catalog-entry-names": func(any) ([]string, error) {
			return nil, nil
		},
	})
	listForBasicUser := func(t *testing.T, marketplaceValue string) types.MCPServerCatalogEntryList {
		t.Helper()
		entry := minimalResponseTestEntry()
		if marketplaceValue != "" {
			entry.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey] = marketplaceValue
		}
		storageClient := storage.Client(fake.NewClientBuilder().
			WithScheme(storagescheme.Scheme).
			WithObjects(&entry).
			Build())
		request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries", nil)
		recorder := httptest.NewRecorder()
		err := (&MCPHandler{
			serverURL: "https://example.com",
			acrHelper: accesscontrolrule.NewAccessControlRuleHelper(indexer, nil),
		}).ListEntriesFromAllSources(api.Context{
			Request:        request,
			ResponseWriter: recorder,
			Storage:        storageClient,
			User: &kuser.DefaultInfo{
				Name:   "basic",
				UID:    "1",
				Groups: []string{types.GroupBasic, types.GroupAuthenticated},
			},
		})
		require.NoError(t, err)

		var response types.MCPServerCatalogEntryList
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
		return response
	}

	t.Run("market closed preserves ACR behavior", func(t *testing.T) {
		require.Empty(t, listForBasicUser(t, "").Items)
	})

	t.Run("market closed ignores publication", func(t *testing.T) {
		require.Empty(t, listForBasicUser(t, "true").Items)
	})

	t.Setenv("OBOT_MARKET_OPEN", "true")
	t.Run("unpublished entries are hidden", func(t *testing.T) {
		require.Empty(t, listForBasicUser(t, "").Items)
	})

	t.Run("explicitly unpublished entries are hidden", func(t *testing.T) {
		require.Empty(t, listForBasicUser(t, "false").Items)
	})

	t.Run("published entries are visible", func(t *testing.T) {
		require.Len(t, listForBasicUser(t, "true").Items, 1)
	})
}

func TestListEntriesFromAllSourcesMarketClosedKeepsACRVisibility(t *testing.T) {
	entry := minimalResponseTestEntry()
	entry.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey] = "false"
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&entry).
		Build())
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(obj any) ([]string, error) {
			rule := obj.(*v1.AccessControlRule)
			if rule.Spec.MCPCatalogID != system.DefaultCatalog {
				return nil, nil
			}
			for _, resource := range rule.Spec.Manifest.Resources {
				if resource.Type == types.ResourceTypeSelector {
					return []string{resource.ID}, nil
				}
			}
			return nil, nil
		},
		"catalog-entry-names": func(any) ([]string, error) {
			return nil, nil
		},
	})
	require.NoError(t, indexer.Add(&v1.AccessControlRule{
		Name:      "basic-market-access",
		Namespace: system.DefaultNamespace,
		Spec: v1.AccessControlRuleSpec{
			MCPCatalogID: system.DefaultCatalog,
			Manifest: types.AccessControlRuleManifest{
				Subjects:  []types.Subject{{Type: types.SubjectTypeGroup, ID: types.GroupBasic}},
				Resources: []types.Resource{{Type: types.ResourceTypeSelector, ID: "*"}},
			},
		},
	}))
	request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries", nil)
	recorder := httptest.NewRecorder()

	err := (&MCPHandler{
		serverURL: "https://example.com",
		acrHelper: accesscontrolrule.NewAccessControlRuleHelper(indexer, nil),
	}).ListEntriesFromAllSources(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "basic",
			UID:    "1",
			Groups: []string{types.GroupBasic, types.GroupAuthenticated},
			Extra: map[string][]string{
				"auth_provider_groups": {types.GroupBasic},
			},
		},
	})
	require.NoError(t, err)

	var response types.MCPServerCatalogEntryList
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Items, 1)
}

func TestListCatalogEntriesMinimal(t *testing.T) {
	entry := minimalResponseTestEntry()
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&v1.MCPCatalog{Name: system.DefaultCatalog, Namespace: system.DefaultNamespace}, &entry).
		WithIndex(&v1.MCPServerCatalogEntry{}, "spec.mcpCatalogName", func(obj kclient.Object) []string {
			return []string{obj.(*v1.MCPServerCatalogEntry).Spec.MCPCatalogName}
		}).
		Build())
	request := httptest.NewRequest(http.MethodGet, "/api/mcp-catalogs/default/entries?all=true&minimal=TRUE", nil)
	request.SetPathValue("catalog_id", system.DefaultCatalog)
	recorder := httptest.NewRecorder()

	err := (&MCPCatalogHandler{serverURL: "https://example.com"}).ListEntries(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "admin",
			UID:    "admin",
			Groups: []string{types.GroupAdmin, types.GroupAuthenticated},
		},
	})
	require.NoError(t, err)

	var response types.MCPServerCatalogEntryList
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Items, 1)
	require.Empty(t, response.Items[0].Manifest.Description)
}

func TestListEntriesFromAllSourcesMarksAuthorizedCatalogEntries(t *testing.T) {
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(any) ([]string, error) {
			return nil, nil
		},
		"catalog-entry-names": func(obj any) ([]string, error) {
			rule := obj.(*v1.AccessControlRule)
			if rule.Spec.MCPCatalogID != system.DefaultCatalog {
				return nil, nil
			}
			for _, resource := range rule.Spec.Manifest.Resources {
				if resource.Type == types.ResourceTypeMCPServerCatalogEntry {
					return []string{resource.ID}, nil
				}
			}
			return nil, nil
		},
	})
	require.NoError(t, indexer.Add(&v1.AccessControlRule{
		Name:      "basic-entry-access",
		Namespace: system.DefaultNamespace,
		Spec: v1.AccessControlRuleSpec{
			MCPCatalogID: system.DefaultCatalog,
			Manifest: types.AccessControlRuleManifest{
				Subjects:  []types.Subject{{Type: types.SubjectTypeGroup, ID: types.GroupBasic}},
				Resources: []types.Resource{{Type: types.ResourceTypeMCPServerCatalogEntry, ID: "test-entry"}},
			},
		},
	}))

	list := func(marketOpen bool) types.MCPServerCatalogEntryList {
		t.Helper()
		t.Setenv("OBOT_MARKET_OPEN", strconv.FormatBool(marketOpen))
		entry := minimalResponseTestEntry()
		entry.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey] = "true"
		storageClient := storage.Client(fake.NewClientBuilder().
			WithScheme(storagescheme.Scheme).
			WithObjects(&entry).
			Build())
		request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries", nil)
		recorder := httptest.NewRecorder()

		err := (&MCPHandler{
			serverURL: "https://example.com",
			acrHelper: accesscontrolrule.NewAccessControlRuleHelper(indexer, nil),
		}).ListEntriesFromAllSources(api.Context{
			Request:        request,
			ResponseWriter: recorder,
			Storage:        storageClient,
			User: &kuser.DefaultInfo{
				Name:   "basic",
				UID:    "1",
				Groups: []string{types.GroupBasic, types.GroupAuthenticated},
				Extra: map[string][]string{
					"auth_provider_groups": {types.GroupBasic},
				},
			},
		})
		require.NoError(t, err)

		var response types.MCPServerCatalogEntryList
		require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
		require.Len(t, response.Items, 1)
		return response
	}

	require.True(t, list(false).Items[0].Authorized)
	require.True(t, list(true).Items[0].Authorized)
}

func TestListEntriesFromAllSourcesMarksUnauthorizedCatalogEntries(t *testing.T) {
	indexer := gocache.NewIndexer(gocache.MetaNamespaceKeyFunc, map[string]gocache.IndexFunc{
		"selectors": func(any) ([]string, error) {
			return nil, nil
		},
		"catalog-entry-names": func(any) ([]string, error) {
			return nil, nil
		},
	})
	t.Setenv("OBOT_MARKET_OPEN", "true")
	entry := minimalResponseTestEntry()
	entry.Spec.Manifest.Metadata[types.MarketPublishedMetadataKey] = "true"
	storageClient := storage.Client(fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&entry).
		Build())
	request := httptest.NewRequest(http.MethodGet, "/api/all-mcps/entries", nil)
	recorder := httptest.NewRecorder()

	err := (&MCPHandler{
		serverURL: "https://example.com",
		acrHelper: accesscontrolrule.NewAccessControlRuleHelper(indexer, nil),
	}).ListEntriesFromAllSources(api.Context{
		Request:        request,
		ResponseWriter: recorder,
		Storage:        storageClient,
		User: &kuser.DefaultInfo{
			Name:   "basic",
			UID:    "2",
			Groups: []string{types.GroupBasic, types.GroupAuthenticated},
		},
	})
	require.NoError(t, err)

	var response types.MCPServerCatalogEntryList
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &response))
	require.Len(t, response.Items, 1)
	require.False(t, response.Items[0].Authorized)
}

func TestConvertMCPServerCatalogEntryForListTransfersAuthorization(t *testing.T) {
	actual := convertMCPServerCatalogEntryForList(minimalResponseTestEntry(), "", "", true, true)
	require.True(t, actual.Authorized)

	actual = convertMCPServerCatalogEntryForList(minimalResponseTestEntry(), "", "", true, false)
	require.False(t, actual.Authorized)
}

func minimalResponseTestEntry() v1.MCPServerCatalogEntry {
	return v1.MCPServerCatalogEntry{
		Name:      "test-entry",
		Namespace: system.DefaultNamespace,
		Spec: v1.MCPServerCatalogEntrySpec{
			MCPCatalogName: system.DefaultCatalog,
			Manifest: types.MCPServerCatalogEntryManifest{
				Metadata:         map[string]string{"category": "developer-tools"},
				EntryKey:         "test-entry-key",
				Name:             "Test Entry",
				ShortDescription: "Short description",
				Description:      "Full description",
				Icon:             "https://example.com/icon.svg",
				RepoURL:          "https://example.com/repo",
				UpgradeNote:      "Upgrade note",
				ToolPreview: []types.MCPServerTool{
					{Name: "tool", Description: "Tool description"},
				},
				Runtime:      types.RuntimeRemote,
				RemoteConfig: &types.RemoteCatalogConfig{FixedURL: "https://example.com/mcp"},
			},
		},
	}
}
