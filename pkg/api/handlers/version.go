package handlers

import (
	"context"
	"log/slog"
	"net/url"
	"os"
	"strings"

	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/gateway/client"
	"github.com/obot-platform/obot/pkg/mcp"
	"github.com/obot-platform/obot/pkg/mcptester"
	"github.com/obot-platform/obot/pkg/version"
)

const (
	SessionStoreDB     SessionStore = "db"
	SessionStoreCookie SessionStore = "cookie"
)

type SessionStore string

type VersionHandlerOptions struct {
	ProviderConfiguration     mcptester.ProviderConfigurationResolver
	ModelProxyURL             *url.URL
	ModelProxySettings        mcptester.ModelProxySettingsReader
	ModelProxyCredential      mcptester.LicenseSource
	GatewayClient             *client.Client
	PostgresDSN               string
	Engine                    string
	MCPNetworkPolicyEnabled   bool
	MCPDefaultDenyAllEgress   bool
	AuthEnabled               bool
	ClaudeEnvironmentsEnabled bool
	HideK8sDetails            bool
}

type VersionHandler struct {
	VersionHandlerOptions

	sessionStore SessionStore
}

func sessionStoreFromPostgresDSN(postgresDSN string) SessionStore {
	if postgresDSN != "" {
		return SessionStoreDB
	}
	return SessionStoreCookie
}

func NewVersionHandler(opts VersionHandlerOptions) *VersionHandler {
	return &VersionHandler{
		VersionHandlerOptions: opts,
		sessionStore:          sessionStoreFromPostgresDSN(opts.PostgresDSN),
	}
}

func (v *VersionHandler) GetVersion(req api.Context) error {
	response, err := v.getVersionResponse(req.Context())
	if err != nil {
		return err
	}
	return req.Write(response)
}

func (v *VersionHandler) getVersionResponse(ctx context.Context) (map[string]any, error) {
	engine := v.Engine
	if mcp.IsKubernetesBackend(engine) {
		engine = mcp.RuntimeBackendKubernetes
	}

	userCount, err := v.GatewayClient.UserCount(ctx)
	if err != nil {
		return nil, err
	}
	deviceCount, err := v.GatewayClient.DeviceCount(ctx)
	if err != nil {
		return nil, err
	}

	values := map[string]any{
		"obot":                    version.Get().String(),
		"authEnabled":             v.AuthEnabled,
		"sessionStore":            v.sessionStore,
		"userCount":               userCount,
		"deviceCount":             deviceCount,
		"engine":                  engine,
		"mcpNetworkPolicyEnabled": v.MCPNetworkPolicyEnabled,
		"mcpDefaultDenyAllEgress": v.MCPDefaultDenyAllEgress,
	}
	for key, value := range v.featureValues() {
		values[key] = value
	}

	if versions := os.Getenv("OBOT_SERVER_VERSIONS"); versions != "" {
		for pair := range strings.SplitSeq(versions, ",") {
			key, value, ok := strings.Cut(pair, "=")
			if !ok {
				continue
			}
			values[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}

	// Model configuration can be changing independently of the rest of the app.
	// Keep the version response available, but never interpret lookup failure as
	// permission to use the external model service.
	availability, availabilityErr := mcptester.ResolveModelProxyAvailability(ctx, v.ModelProxyURL, v.ProviderConfiguration, v.ModelProxySettings)
	if availabilityErr != nil {
		slog.Warn("model provider availability unresolved", "error", availabilityErr)
	}
	proxyCredentialConfigured := false
	if availabilityErr == nil && availability.Enabled && v.ModelProxyCredential != nil {
		key, err := v.ModelProxyCredential.LicenseKey(ctx)
		proxyCredentialConfigured = err == nil && key != ""
	}

	// Set after OBOT_SERVER_VERSIONS so capability values cannot be overridden.
	values["hasModelProvider"] = availability.HasModelProvider
	values["mcpTesterModelProxyAvailable"] = proxyCredentialConfigured

	return values, nil
}

func (v *VersionHandler) featureValues() map[string]bool {
	return map[string]bool{
		"claudeEnvironmentsEnabled": v.ClaudeEnvironmentsEnabled,
		"hideK8sDetails":            v.HideK8sDetails,
	}
}
