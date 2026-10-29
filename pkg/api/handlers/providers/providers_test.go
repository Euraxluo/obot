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
