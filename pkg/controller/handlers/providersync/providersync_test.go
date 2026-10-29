package providersync

import (
	"testing"

	"github.com/obot-platform/nah/pkg/router"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/types"
)

type recordingStopper struct {
	authStops map[string]int
}

func newRecordingStopper() *recordingStopper {
	return &recordingStopper{
		authStops: make(map[string]int),
	}
}

func (r *recordingStopper) StopAuthProvider(namespace, authProviderName string) {
	r.authStops[namespace+"/"+authProviderName]++
}

func TestReconcileStopsOnlyProvidersWithNewRevisions(t *testing.T) {
	stopper := newRecordingStopper()
	handler := New(stopper)
	daemonSync := &v1.ProviderSync{
		UID: types.UID("sync-1"),
		Spec: v1.ProviderSyncSpec{
			Revisions: map[string]v1.ProviderRevision{
				"auth/default/entra": {
					ProviderType:      v1.ProviderTypeAuth,
					ProviderNamespace: "default",
					ProviderName:      "entra",
					Revision:          2,
				},
			},
		},
	}

	require.NoError(t, handler.Reconcile(router.Request{Object: daemonSync}, nil))
	assert.Equal(t, 1, stopper.authStops["default/entra"])

	require.NoError(t, handler.Reconcile(router.Request{Object: daemonSync}, nil))
	assert.Equal(t, 1, stopper.authStops["default/entra"])

	authRevision := daemonSync.Spec.Revisions["auth/default/entra"]
	authRevision.Revision++
	daemonSync.Spec.Revisions["auth/default/entra"] = authRevision
	require.NoError(t, handler.Reconcile(router.Request{Object: daemonSync}, nil))
	authRevision.Revision = 1
	daemonSync.Spec.Revisions["auth/default/entra"] = authRevision
	require.NoError(t, handler.Reconcile(router.Request{Object: daemonSync}, nil))
	assert.Equal(t, 2, stopper.authStops["default/entra"])
}

func TestReconcileTreatsRecreatedSyncAsNew(t *testing.T) {
	stopper := newRecordingStopper()
	handler := New(stopper)
	revision := v1.ProviderRevision{
		ProviderType:      v1.ProviderTypeAuth,
		ProviderNamespace: "default",
		ProviderName:      "entra",
		Revision:          9,
	}

	require.NoError(t, handler.Reconcile(router.Request{
		Object: &v1.ProviderSync{
			UID: types.UID("sync-1"),
			Spec: v1.ProviderSyncSpec{
				Revisions: map[string]v1.ProviderRevision{
					"auth/default/entra": revision,
				},
			},
		},
	}, nil))

	revision.Revision = 1
	require.NoError(t, handler.Reconcile(router.Request{
		Object: &v1.ProviderSync{
			UID: types.UID("sync-2"),
			Spec: v1.ProviderSyncSpec{
				Revisions: map[string]v1.ProviderRevision{
					"auth/default/entra": revision,
				},
			},
		},
	}, nil))
	assert.Equal(t, 2, stopper.authStops["default/entra"])
}

func TestReconcileIgnoresRemovedProviderTypes(t *testing.T) {
	stopper := newRecordingStopper()
	handler := New(stopper)
	require.NoError(t, handler.Reconcile(router.Request{
		Object: &v1.ProviderSync{
			Spec: v1.ProviderSyncSpec{
				Revisions: map[string]v1.ProviderRevision{
					"removed": {
						ProviderType:      "removed",
						ProviderNamespace: "default",
						ProviderName:      "provider",
						Revision:          1,
					},
				},
			},
		},
	}, nil))
	assert.Empty(t, stopper.authStops)
}
