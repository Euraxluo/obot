package provider

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/obot-platform/nah/pkg/apply"
	"github.com/obot-platform/nah/pkg/router"
	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api/handlers/providers"
	"github.com/obot-platform/obot/pkg/auth"
	gateway "github.com/obot-platform/obot/pkg/gateway/client"
	"github.com/obot-platform/obot/pkg/gateway/server/dispatcher"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
	"go.yaml.in/yaml/v3"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	providerRegistryOwnerSubContext = "providers"
	modelProvidersRegistryDir       = "model-providers"
	authProvidersRegistryDir        = "auth-providers"
	providerRegistryMaxFiles        = 1000
)

var (
	jsonErrRegexp            = regexp.MustCompile(`(?s)\{.*"error":.*}`)
	providerNameInvalidChars = regexp.MustCompile(`[^a-z0-9-]+`)
	providerNameDashes       = regexp.MustCompile(`-{2,}`)
)

type Handler struct {
	gatewayClient *gateway.Client
	dispatcher    *dispatcher.Dispatcher
	registryPaths []string
}

type providerFromFile[T types.AuthProviderManifest] struct {
	Name     string `yaml:"-"`
	Manifest T      `yaml:",inline"`
}

// upstreamProviderLister is a built-in model provider that routes to several upstream
// providers, such as the LLM gateway.
type upstreamProviderLister interface {
	ConfiguredProviders(ctx context.Context) ([]string, error)
}

func New(gatewayClient *gateway.Client, dispatcher *dispatcher.Dispatcher, registryPaths []string) *Handler {
	return &Handler{
		gatewayClient: gatewayClient,
		dispatcher:    dispatcher,
		registryPaths: registryPaths,
	}
}

func providerResourceName(n string) string {
	n = strings.ToLower(n)
	n = providerNameInvalidChars.ReplaceAllString(n, "-")
	n = providerNameDashes.ReplaceAllString(n, "-")
	n = strings.Trim(n, "-")
	if len(n) <= 63 {
		return n
	}

	sum := fmt.Sprintf("%x", sha256.Sum256([]byte(n)))
	n = strings.Trim(n[:50], "-")
	return strings.Trim(fmt.Sprintf("%s-%s", n, sum[:12]), "-")
}

func providerName(path string) string {
	base := filepath.Base(path)
	return strings.TrimSuffix(base, filepath.Ext(base))
}

func isYAMLFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".yaml", ".yml":
		return true
	default:
		return false
	}
}

func readProviderDirectory[T types.AuthProviderManifest](dir string) ([]providerFromFile[T], error) {
	fileInfo, err := os.Stat(dir)
	if err != nil {
		return nil, err
	}
	if !fileInfo.IsDir() {
		return nil, fmt.Errorf("provider registry path %s is not a directory", dir)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("failed to read provider registry directory %s: %w", dir, err)
	}

	var providers []providerFromFile[T]
	for _, entry := range entries {
		if entry.IsDir() || !isYAMLFile(entry.Name()) {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("failed to read provider registry file %s: %w", entry.Name(), err)
		}

		var providerManifest providerFromFile[T]
		if err = yaml.Unmarshal(content, &providerManifest); err != nil {
			return nil, fmt.Errorf("failed to parse provider registry file %s: %w", entry.Name(), err)
		}

		providerManifest.Name = providerResourceName(providerName(entry.Name()))

		providers = append(providers, providerManifest)
		if len(providers) >= providerRegistryMaxFiles {
			slog.Warn("Reached maximum number of provider registry files, skipping remaining files in directory", "maxFiles", providerRegistryMaxFiles, "dir", dir)
			break
		}
	}

	return providers, nil
}

func readProviderDirectoryIgnoreMissing[T types.AuthProviderManifest](dir string) ([]providerFromFile[T], error) {
	entries, err := readProviderDirectory[T](dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	return entries, err
}

func readRegistry(registryPath string) ([]kclient.Object, error) {
	fileInfo, err := os.Stat(registryPath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat provider registry %s: %w", registryPath, err)
	}
	if !fileInfo.IsDir() {
		return nil, fmt.Errorf("provider registry path %s is not a directory", registryPath)
	}

	auths, err := readProviderDirectoryIgnoreMissing[types.AuthProviderManifest](filepath.Join(registryPath, authProvidersRegistryDir))
	if err != nil {
		return nil, fmt.Errorf("failed to read auth providers from registry %s: %w", registryPath, err)
	}

	return appendProviders(registryPath, auths), nil
}

// appendProviders converts a registry's auth providers to objects. Registries also ship model
// providers, which the LLM gateway replaced, so they are ignored.
func appendProviders(registryPath string, authProviderManifests []providerFromFile[types.AuthProviderManifest]) []kclient.Object {
	objs := make([]kclient.Object, 0, len(authProviderManifests))

	for _, a := range authProviderManifests {
		if a.Manifest.Command == "" {
			slog.Warn("Skipping auth provider with missing required fields", "name", a.Name, "command", a.Manifest.Command)
			continue
		}
		if err := auth.ValidateGroupIDPrefix(a.Manifest.GroupIDPrefix); err != nil {
			slog.Warn("Skipping auth provider with invalid group ID prefix", "name", a.Name, "groupIDPrefix", a.Manifest.GroupIDPrefix, "error", err)
			continue
		}

		a.Manifest.Command = path.Join(registryPath, a.Manifest.Command)

		objs = append(objs, &v1.AuthProvider{
			Name: a.Name,
			Spec: v1.AuthProviderSpec{
				AuthProviderManifest: a.Manifest,
			},
		})
	}

	return objs
}

func validateUniqueAuthProviderGroupIDPrefixes(objs []kclient.Object) error {
	providersByPrefix := make(map[string]string)
	for _, obj := range objs {
		provider, ok := obj.(*v1.AuthProvider)
		if !ok || provider.Spec.GroupIDPrefix == "" {
			continue
		}

		prefix := strings.ToLower(provider.Spec.GroupIDPrefix)
		if existingProvider, ok := providersByPrefix[prefix]; ok {
			return fmt.Errorf("auth providers %q and %q declare the same group ID prefix %q", existingProvider, provider.Name, provider.Spec.GroupIDPrefix)
		}
		providersByPrefix[prefix] = provider.Name
	}
	return nil
}

func (h *Handler) ReadFromRegistry(ctx context.Context, c kclient.Client) error {
	var (
		toAdd []kclient.Object
		errs  []error
	)
	for _, registryPath := range h.registryPaths {
		objs, err := readRegistry(registryPath)
		if err != nil {
			errs = append(errs, fmt.Errorf("failed to read provider registry %s: %w", registryPath, err))
			continue
		}
		slog.Info("Loaded provider registry", "registry", registryPath, "providers", len(objs))
		toAdd = append(toAdd, objs...)
	}

	if len(errs) > 0 {
		// Do not accidentally delete providers for registry URLs that failed to be read.
		slog.Info("Skipping provider registry apply due to registry read errors", "failedRegistries", len(errs))
		return errors.Join(errs...)
	}

	if len(toAdd) == 0 {
		// Do not accidentally delete all the providers.
		slog.Info("Skipping provider registry apply because no providers were resolved")
		return nil
	}
	if err := validateUniqueAuthProviderGroupIDPrefixes(toAdd); err != nil {
		return fmt.Errorf("validate provider registries: %w", err)
	}

	slog.Info("Applying resolved providers from registries", "providers", len(toAdd))
	// Only auth providers are pruned. Model providers the registry created before the LLM
	// gateway replaced them are deleted once the gateway has migrated them.
	return apply.New(c).WithOwnerSubContext(providerRegistryOwnerSubContext).WithPruneTypes(&v1.AuthProvider{}).Apply(ctx, nil, toAdd...)
}

func (h *Handler) PollRegistries(ctx context.Context, c kclient.Client) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		if err := h.ReadFromRegistry(ctx, c); err != nil {
			slog.Error("Failed to read from registries", "error", err)
		} else {
			slog.Info("Completed periodic provider registry refresh")
		}

		select {
		case <-t.C:
		case <-ctx.Done():
			return
		}
	}
}

func (h *Handler) SetAuthProviderConfiguredStatus(req router.Request, _ router.Response) error {
	authProvider := req.Object.(*v1.AuthProvider)
	return SetAuthProviderConfiguredStatus(req.Ctx, h.gatewayClient, authProvider)
}

func SetAuthProviderConfiguredStatus(ctx context.Context, gatewayClient *gateway.Client, authProvider *v1.AuthProvider) error {
	var (
		configured          = true
		missingConfigParams []string
	)
	if len(authProvider.Spec.RequiredConfigurationParameters) > 0 {
		cred, err := gatewayClient.RevealCredential(ctx, []string{authProvider.Name, system.GenericAuthProviderCredentialContext}, authProvider.Name)
		if err != nil && !errors.As(err, &gateway.CredentialNotFoundError{}) {
			return fmt.Errorf("failed to reveal credential for auth provider %q: %w", authProvider.Name, err)
		}

		if cred.Secrets == nil {
			// Don't pass a nil map so that the provider status functions can distinguish between "no credential found" and "credential found but has no secrets"
			cred.Secrets = make(map[string]string)
		}

		// A SCIM connection relaxes the parameters that only directory synchronization uses. The controller does not
		// watch the gateway database, so whatever creates or deletes a connection recomputes this status.
		conn, err := gatewayClient.SCIMConnectionForAuthProvider(ctx, authProvider.Namespace, authProvider.Name)
		if err != nil {
			return err
		}

		providerStatus, err := providers.AuthProviderStatus(ctx, *authProvider, cred.Secrets, conn)
		if err != nil {
			return err
		}

		configured = providerStatus.Configured
		missingConfigParams = providerStatus.MissingConfigurationParameters
	}

	authProvider.Status.MissingConfigurationParameters = missingConfigParams
	authProvider.Status.Configured = configured
	authProvider.Status.ObservedGeneration = authProvider.Generation

	return nil
}
