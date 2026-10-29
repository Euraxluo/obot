package client

import (
	"context"
	"net/url"
	"testing"

	apitypes "github.com/obot-platform/obot/apiclient/types"
	gatewaydb "github.com/obot-platform/obot/pkg/gateway/db"
	gatewaytypes "github.com/obot-platform/obot/pkg/gateway/types"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	storagescheme "github.com/obot-platform/obot/pkg/storage/scheme"
	storageservices "github.com/obot-platform/obot/pkg/storage/services"
	"github.com/obot-platform/obot/pkg/system"
	"sigs.k8s.io/controller-runtime/pkg/client/fake"
)

const postgresUserLimitTestDSNEnv = "OBOT_TEST_POSTGRES_DSN"

type userLimitProviderFunc func(context.Context) (UserLimit, error)

func (f userLimitProviderFunc) UserLimit(ctx context.Context) (UserLimit, error) {
	return f(ctx)
}

func newIdentityUserLimitTestClient(t *testing.T) *Client {
	t.Helper()

	client := newTestClient(t)
	client.storageClient = fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&v1.UserDefaultRoleSetting{
			Namespace: system.DefaultNamespace,
			Name:      system.DefaultRoleSettingName,
			Spec: v1.UserDefaultRoleSettingSpec{
				Role: apitypes.RoleBasic,
			},
		}).
		Build()
	return client
}

func ensureUserLimitTestIdentity(ctx context.Context, client *Client, username string) (*gatewaytypes.User, error) {
	return client.EnsureIdentityWithRole(ctx, &gatewaytypes.Identity{
		ProviderUsername: username,
		ProviderUserID:   username,
	}, "", apitypes.RoleBasic, UserLimit{Maximum: 1})
}

func postgresUserLimitTestDSN(t *testing.T, dsn, schema string) string {
	t.Helper()

	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parsing %s: %v", postgresUserLimitTestDSNEnv, err)
	}
	query := u.Query()
	query.Set("search_path", schema)
	u.RawQuery = query.Encode()
	return u.String()
}

func newPostgresUserLimitTestDB(t *testing.T, dsn string) *gatewaydb.DB {
	t.Helper()

	services, err := storageservices.New(storageservices.Config{DSN: dsn})
	if err != nil {
		t.Fatalf("opening scoped PostgreSQL connection: %v", err)
	}
	t.Cleanup(func() {
		if err := services.DB.SQLDB.Close(); err != nil {
			t.Errorf("closing scoped PostgreSQL connection: %v", err)
		}
	})

	database, err := gatewaydb.New(services.DB.DB, services.DB.SQLDB, false)
	if err != nil {
		t.Fatalf("creating gateway PostgreSQL database: %v", err)
	}
	return database
}

func newPostgresUserLimitTestClient(database *gatewaydb.DB) *Client {
	storageClient := fake.NewClientBuilder().
		WithScheme(storagescheme.Scheme).
		WithObjects(&v1.UserDefaultRoleSetting{
			Namespace: system.DefaultNamespace,
			Name:      system.DefaultRoleSettingName,
			Spec: v1.UserDefaultRoleSettingSpec{
				Role: apitypes.RoleBasic,
			},
		}).
		Build()

	return &Client{
		db:            database,
		storageClient: storageClient,
	}
}
