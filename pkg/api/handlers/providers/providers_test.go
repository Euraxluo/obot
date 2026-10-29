package providers

import (
	"reflect"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
)

func TestAuthProviderStatus(t *testing.T) {
	tests := []struct {
		name         string
		authProvider v1.AuthProvider
		cred         map[string]string
		want         types.CommonProviderStatus
	}{
		{
			name:         "configured when requirements are satisfied",
			authProvider: testAuthProvider(),
			cred:         map[string]string{"API_KEY": "secret"},
			want:         types.CommonProviderStatus{Configured: true},
		},
		{
			name:         "missing credential value is not configured",
			authProvider: testAuthProvider(),
			cred:         map[string]string{},
			want: types.CommonProviderStatus{
				Configured:                     false,
				MissingConfigurationParameters: []string{"API_KEY"},
			},
		},
		{
			name:         "nil credential uses configured parameters",
			authProvider: testAuthProvider(),
			cred:         nil,
			want: types.CommonProviderStatus{
				Configured:                     false,
				MissingConfigurationParameters: []string{"API_KEY"},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := AuthProviderStatus(t.Context(), tt.authProvider, tt.cred, nil)
			if err != nil {
				t.Fatalf("AuthProviderStatus() error = %v", err)
			}
			if !reflect.DeepEqual(got.CommonProviderStatus, tt.want) {
				t.Fatalf("AuthProviderStatus() = %#v, want %#v", got.CommonProviderStatus, tt.want)
			}
		})
	}
}

func TestModelProviderStatus(t *testing.T) {
	tests := []struct {
		name          string
		modelProvider v1.ModelProvider
		cred          map[string]string
		want          types.ModelProviderStatus
	}{
		{
			name:          "configured with current models",
			modelProvider: testModelProvider(2),
			cred:          map[string]string{"API_KEY": "secret"},
			want: types.ModelProviderStatus{
				CommonProviderStatus: types.CommonProviderStatus{Configured: true},
				ModelsBackPopulated:  boolPtr(true),
			},
		},
		{
			name:          "configured with stale models",
			modelProvider: testModelProvider(1),
			cred:          map[string]string{"API_KEY": "secret"},
			want: types.ModelProviderStatus{
				CommonProviderStatus: types.CommonProviderStatus{Configured: true},
				ModelsBackPopulated:  boolPtr(false),
			},
		},
		{
			name:          "missing credential skips model population status",
			modelProvider: testModelProvider(2),
			cred:          map[string]string{},
			want: types.ModelProviderStatus{
				CommonProviderStatus: types.CommonProviderStatus{
					Configured:                     false,
					MissingConfigurationParameters: []string{"API_KEY"},
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := ModelProviderStatus(t.Context(), tt.modelProvider, tt.cred)
			if err != nil {
				t.Fatalf("ModelProviderStatus() error = %v", err)
			}
			if !reflect.DeepEqual(*got, tt.want) {
				t.Fatalf("ModelProviderStatus() = %#v, want %#v", *got, tt.want)
			}
		})
	}
}

func testAuthProvider() v1.AuthProvider {
	return v1.AuthProvider{
		Spec: v1.AuthProviderSpec{
			AuthProviderManifest: types.AuthProviderManifest{
				CommonProviderMetadata: types.CommonProviderMetadata{
					RequiredConfigurationParameters: []types.ProviderConfigurationParameter{{Name: "API_KEY"}},
				},
			},
		},
	}
}

func testModelProvider(observedGeneration int64) v1.ModelProvider {
	return v1.ModelProvider{
		Generation: 2,
		Spec: v1.ModelProviderSpec{
			ModelProviderManifest: types.ModelProviderManifest{
				CommonProviderMetadata: types.CommonProviderMetadata{
					RequiredConfigurationParameters: []types.ProviderConfigurationParameter{{Name: "API_KEY"}},
				},
			},
		},
		Status: v1.ModelProviderStatus{ObservedGeneration: observedGeneration},
	}
}

func boolPtr(value bool) *bool {
	return &value
}
