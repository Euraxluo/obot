package client

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	types2 "github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/gateway/types"
	"github.com/obot-platform/obot/pkg/principal"
	"k8s.io/apiserver/pkg/authentication/authenticator"
	"k8s.io/apiserver/pkg/authentication/user"
)

// UserLimit describes the maximum number of users an installation may have.
// Maximum is ignored when Unlimited is true.
type UserLimit struct {
	Maximum   int64
	Unlimited bool
}

// UserLimitProvider is retained for compatibility with callers that have not
// yet dropped the old license wiring. Internal editions do not enforce it.
type UserLimitProvider interface {
	UserLimit(context.Context) (UserLimit, error)
}

type UserDecorator struct {
	next   authenticator.Request
	client *Client
}

func NewUserDecorator(next authenticator.Request, client *Client, _ UserLimitProvider) *UserDecorator {
	return &UserDecorator{
		next:   next,
		client: client,
	}
}

func (u UserDecorator) AuthenticateRequest(req *http.Request) (*authenticator.Response, bool, error) {
	resp, ok, err := u.next.AuthenticateRequest(req)
	if err != nil {
		return nil, false, err
	} else if !ok {
		return nil, false, nil
	}

	var (
		gatewayUser  *types.User
		authGroupIDs []string
	)
	if authProviderNamespace, authProviderName := cmp.Or(resp.User.GetExtra()["auth_provider_namespace"]...), cmp.Or(resp.User.GetExtra()["auth_provider_name"]...); authProviderNamespace != "" && authProviderName != "" {
		identity := &types.Identity{
			Email:                 cmp.Or(resp.User.GetExtra()["email"]...),
			AuthProviderName:      authProviderName,
			AuthProviderNamespace: authProviderNamespace,
			ProviderUsername:      resp.User.GetName(),
			ProviderUserID:        resp.User.GetUID(),
		}

		gatewayUser, err = u.client.EnsureIdentity(req.Context(), identity, req.Header.Get("X-Obot-User-Timezone"), UserLimit{Unlimited: true})
		if err != nil {
			if _, ok := errors.AsType[*types2.ErrHTTP](err); ok {
				return nil, false, err
			}
			if _, ok := errors.AsType[*FetchUserGroupsError](err); ok {
				return nil, false, err
			}
			if _, ok := errors.AsType[*UserAccessDeniedError](err); ok {
				// Such as a sign-in that SCIM has not provisioned, once SCIM is enforced for the auth provider.
				return nil, false, err
			}
			// The user could not be read, so their status is unknown.
			return nil, false, &UserAccessLookupError{
				Err: err,
			}
		}

		authGroupIDs = identity.GetAuthProviderGroupIDs()
	} else {
		return nil, false, nil
	}

	extra := resp.User.GetExtra()
	extra["auth_provider_groups"] = authGroupIDs
	// The admission check denies the request unless the user is active. The status comes from the user row that
	// EnsureIdentity just read, and replaces anything the auth provider supplied.
	principal.RecordUserStatus(extra, gatewayUser.Status())

	// Resolve effective role by merging individual + group roles
	effectiveRole, err := u.client.ResolveUserEffectiveRole(req.Context(), gatewayUser, authGroupIDs)
	if err != nil {
		// Log error but don't fail authentication - fall back to individual role
		slog.Warn("failed to resolve effective role for user", "userID", gatewayUser.ID, "error", err)
		effectiveRole = gatewayUser.Role
	}

	extra["obot_groups"] = effectiveRole.Groups()

	resp.User = &user.DefaultInfo{
		Name:   gatewayUser.Username,
		UID:    fmt.Sprintf("%d", gatewayUser.ID),
		Extra:  extra,
		Groups: effectiveRole.Groups(),
	}
	return resp, true, nil
}
