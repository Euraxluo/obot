package types

import (
	"fmt"
	"strings"
)

// ConnectorAccessRequest statuses.
const (
	ConnectorAccessRequestPending  = "pending"
	ConnectorAccessRequestApproved = "approved"
	ConnectorAccessRequestRejected = "rejected"
)

// ConnectorAccessRequest is an end user's request to connect a marketplace
// connector (MCP catalog entry). Admins approve or reject it; approval grants
// the requester user-level access to the entry.
type ConnectorAccessRequest struct {
	Metadata `json:",inline"`

	Manifest ConnectorAccessRequestManifest `json:"manifest,omitempty"`
}

type ConnectorAccessRequestManifest struct {
	// RequesterUserID is the UID of the user requesting the connector.
	RequesterUserID string `json:"requesterUserID"`
	// RequesterUsername and RequesterEmail snapshot the requester for display.
	RequesterUsername string `json:"requesterUsername,omitempty"`
	RequesterEmail    string `json:"requesterEmail,omitempty"`
	// ConnectorID is the MCPServerCatalogEntry name to connect.
	ConnectorID string `json:"connectorID"`
	// ConnectorName snapshots the entry's display name for display.
	ConnectorName string `json:"connectorName,omitempty"`
	// MCPCatalogID is the catalog the entry belongs to (default catalog when empty).
	MCPCatalogID string `json:"mcpCatalogID,omitempty"`
	// Status is pending, approved, or rejected.
	Status string `json:"status"`
	// Reason is the requester's optional note.
	Reason string `json:"reason,omitempty"`
	// ReviewerUserID and ReviewerUsername snapshot the admin that reviewed the request.
	ReviewerUserID   string `json:"reviewerUserID,omitempty"`
	ReviewerUsername string `json:"reviewerUsername,omitempty"`
	// ReviewComment is the admin's optional comment (rejection reason).
	ReviewComment string `json:"reviewComment,omitempty"`
}

type ConnectorAccessRequestList List[ConnectorAccessRequest]

func (c ConnectorAccessRequestManifest) Validate() error {
	c.ConnectorID = strings.TrimSpace(c.ConnectorID)
	if c.ConnectorID == "" {
		return fmt.Errorf("connectorID is required")
	}
	if c.RequesterUserID == "" {
		return fmt.Errorf("requesterUserID is required")
	}
	switch c.Status {
	case "", ConnectorAccessRequestPending:
		return nil
	default:
		return fmt.Errorf("invalid status %q", c.Status)
	}
}

type ConnectorAccessReview struct {
	Comment string `json:"comment,omitempty"`
}
