package client

import (
	"testing"
)

func TestEnsureIdentityIgnoresLegacyUserLimit(t *testing.T) {
	client := newIdentityUserLimitTestClient(t)

	for _, username := range []string{"user-1", "user-2"} {
		_, err := ensureUserLimitTestIdentity(t.Context(), client, username)
		if err != nil {
			t.Fatalf("create %s: %v", username, err)
		}
	}
}

func TestEnrollDeviceIgnoresLegacyDeviceLimit(t *testing.T) {
	client := newTestClient(t)
	limit := DeviceLimit{Maximum: 1}

	for _, deviceID := range []string{"device-1", "device-2"} {
		if _, err := client.EnrollDevice(t.Context(), DeviceEnrollment{
			DeviceID:  deviceID,
			PublicKey: []byte(deviceID),
		}, limit); err != nil {
			t.Fatalf("enroll %s: %v", deviceID, err)
		}
	}
}
