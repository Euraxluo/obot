package client

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const (
	modelProxyCredentialKeyPropertyKey       = "obot-license-key"
	modelProxyCredentialMachineIDPropertyKey = "obot-license-machine-id"
)

func newUUID() string {
	return uuid.NewString()
}

// ModelProxyCredentialSource supplies the external model proxy's installation
// credential without validating it as an Obot edition license.
type ModelProxyCredentialSource struct {
	client             *Client
	machineFingerprint string
}

func NewModelProxyCredentialSource(ctx context.Context, client *Client) (*ModelProxyCredentialSource, error) {
	property, err := client.GetOrCreateProperty(ctx, modelProxyCredentialMachineIDPropertyKey, newUUID())
	if err != nil {
		return nil, fmt.Errorf("failed to ensure model proxy machine ID: %w", err)
	}
	return &ModelProxyCredentialSource{
		client:             client,
		machineFingerprint: property.Value,
	}, nil
}

func (s *ModelProxyCredentialSource) LicenseKey(ctx context.Context) (string, error) {
	property, err := s.client.GetProperty(ctx, modelProxyCredentialKeyPropertyKey)
	if err != nil {
		return "", fmt.Errorf("failed to get model proxy credential: %w", err)
	}
	return strings.TrimSpace(property.Value), nil
}

func (s *ModelProxyCredentialSource) MachineFingerprint() string {
	return s.machineFingerprint
}
