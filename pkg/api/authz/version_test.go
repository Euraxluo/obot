package authz

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"k8s.io/apiserver/pkg/authentication/user"
)

func TestVersionAuthorizationIsScopedToDevLogin(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		allowed bool
	}{
		{
			name: "disabled by default",
		},
		{
			name:    "enabled for the local development stack",
			enabled: true,
			allowed: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.enabled {
				t.Setenv("OBOT_DEV_LOGIN", "true")
			} else {
				t.Setenv("OBOT_DEV_LOGIN", "")
			}

			authorizer := NewAuthorizer(nil, nil, nil, false, nil, nil, false)
			req := httptest.NewRequest(http.MethodGet, "/api/version", nil)
			got := authorizer.Authorize(req, &user.DefaultInfo{
				Name:   "anonymous",
				Groups: []string{UnauthenticatedGroup},
			})
			if got != tt.allowed {
				t.Fatalf("Authorize(GET /api/version, unauthenticated) = %v, want %v", got, tt.allowed)
			}
		})
	}
}
