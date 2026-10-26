package handlers

import (
	"fmt"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
)

type ConnectorAccessRequestHandler struct{}

func NewConnectorAccessRequestHandler() *ConnectorAccessRequestHandler {
	return nil
}

// Create files an end user's request to connect a marketplace connector.
func (*ConnectorAccessRequestHandler) Create(req api.Context) error {
	var manifest types.ConnectorAccessRequestManifest
	if err := req.Read(&manifest); err != nil {
		return types.NewErrBadRequest("failed to read connector access request manifest: %v", err)
	}

	manifest.RequesterUserID = req.User.GetUID()
	manifest.RequesterUsername = req.User.GetName()
	if email := req.User.GetExtra()["email"]; len(email) > 0 {
		manifest.RequesterEmail = email[0]
	}
	manifest.Status = types.ConnectorAccessRequestPending

	if err := manifest.Validate(); err != nil {
		return types.NewErrBadRequest("invalid connector access request manifest: %v", err)
	}

	var entry v1.MCPServerCatalogEntry
	if err := req.Get(&entry, manifest.ConnectorID); err != nil {
		return types.NewErrBadRequest("connector not found: %v", err)
	}
	if entry.Spec.MCPCatalogName == "" {
		return types.NewErrBadRequest("connector is not published in a catalog")
	}
	manifest.MCPCatalogID = entry.Spec.MCPCatalogName
	if zh := entry.Spec.Manifest.Metadata["displayNameZh"]; zh != "" {
		manifest.ConnectorName = zh
	} else {
		manifest.ConnectorName = entry.Spec.Manifest.Name
	}

	// One open (pending or approved) request per user per connector. A rejected
	// request may be superseded by filing a new one.
	existing, err := connectorAccessRequestsFor(req, manifest.RequesterUserID, manifest.ConnectorID)
	if err != nil {
		return err
	}
	for _, other := range existing {
		switch other.Spec.Manifest.Status {
		case types.ConnectorAccessRequestPending:
			return types.NewErrBadRequest("a request for this connector is already pending")
		case types.ConnectorAccessRequestApproved:
			return types.NewErrBadRequest("this connector is already approved")
		}
	}

	request := v1.ConnectorAccessRequest{
		GenerateName: system.ConnectorAccessRequestPrefix,
		Namespace:    req.Namespace(),
		Spec: v1.ConnectorAccessRequestSpec{
			Manifest: manifest,
		},
	}
	if err := req.Create(&request); err != nil {
		return fmt.Errorf("failed to create connector access request: %w", err)
	}

	return req.WriteCreated(convertConnectorAccessRequest(request))
}

// List returns connector access requests. Admins see all (optionally filtered
// by ?status=); everyone else only their own.
func (*ConnectorAccessRequestHandler) List(req api.Context) error {
	var list v1.ConnectorAccessRequestList
	if err := req.List(&list); err != nil {
		return fmt.Errorf("failed to list connector access requests: %w", err)
	}

	statusFilter := req.URL.Query().Get("status")
	mineOnly := !req.UserIsAdmin() || req.URL.Query().Get("mine") == "true"

	items := make([]types.ConnectorAccessRequest, 0, len(list.Items))
	for _, item := range list.Items {
		if statusFilter != "" && item.Spec.Manifest.Status != statusFilter {
			continue
		}
		if mineOnly && item.Spec.Manifest.RequesterUserID != req.User.GetUID() {
			continue
		}
		items = append(items, convertConnectorAccessRequest(item))
	}

	return req.Write(types.ConnectorAccessRequestList{Items: items})
}

// Get returns a single connector access request, to its requester or an admin.
func (*ConnectorAccessRequestHandler) Get(req api.Context) error {
	var request v1.ConnectorAccessRequest
	if err := req.Get(&request, req.PathValue("connector_access_request_id")); err != nil {
		return fmt.Errorf("failed to get connector access request: %w", err)
	}

	if !req.UserIsAdmin() && request.Spec.Manifest.RequesterUserID != req.User.GetUID() {
		return types.NewErrForbidden("not your connector access request")
	}

	return req.Write(convertConnectorAccessRequest(request))
}

// Approve marks a request approved and grants the requester user-level access
// to the connector via an AccessControlRule.
func (*ConnectorAccessRequestHandler) Approve(req api.Context) error {
	var review types.ConnectorAccessReview
	_ = req.Read(&review) // comment is optional

	request, err := getPendingConnectorAccessRequest(req)
	if err != nil {
		return err
	}

	request.Spec.Manifest.Status = types.ConnectorAccessRequestApproved
	request.Spec.Manifest.ReviewerUserID = req.User.GetUID()
	request.Spec.Manifest.ReviewerUsername = req.User.GetName()
	request.Spec.Manifest.ReviewComment = review.Comment

	if err := grantConnectorAccess(req, &request); err != nil {
		return err
	}
	if err := req.Update(&request); err != nil {
		return fmt.Errorf("failed to update connector access request: %w", err)
	}

	return req.Write(convertConnectorAccessRequest(request))
}

// Reject marks a request rejected, optionally with a comment.
func (*ConnectorAccessRequestHandler) Reject(req api.Context) error {
	var review types.ConnectorAccessReview
	_ = req.Read(&review) // comment is optional

	request, err := getPendingConnectorAccessRequest(req)
	if err != nil {
		return err
	}

	request.Spec.Manifest.Status = types.ConnectorAccessRequestRejected
	request.Spec.Manifest.ReviewerUserID = req.User.GetUID()
	request.Spec.Manifest.ReviewerUsername = req.User.GetName()
	request.Spec.Manifest.ReviewComment = review.Comment

	if err := req.Update(&request); err != nil {
		return fmt.Errorf("failed to update connector access request: %w", err)
	}

	return req.Write(convertConnectorAccessRequest(request))
}

func getPendingConnectorAccessRequest(req api.Context) (v1.ConnectorAccessRequest, error) {
	if !req.UserIsAdmin() {
		return v1.ConnectorAccessRequest{}, types.NewErrForbidden("admin only")
	}

	var request v1.ConnectorAccessRequest
	if err := req.Get(&request, req.PathValue("connector_access_request_id")); err != nil {
		return v1.ConnectorAccessRequest{}, fmt.Errorf("failed to get connector access request: %w", err)
	}
	if request.Spec.Manifest.Status != types.ConnectorAccessRequestPending {
		return v1.ConnectorAccessRequest{}, types.NewErrBadRequest("request is not pending")
	}
	return request, nil
}

// connectorAccessRequestsFor lists a user's requests for one connector.
func connectorAccessRequestsFor(req api.Context, requesterUserID, connectorID string) ([]v1.ConnectorAccessRequest, error) {
	var list v1.ConnectorAccessRequestList
	if err := req.List(&list); err != nil {
		return nil, fmt.Errorf("failed to list connector access requests: %w", err)
	}

	var matched []v1.ConnectorAccessRequest
	for _, item := range list.Items {
		if item.Spec.Manifest.RequesterUserID == requesterUserID && item.Spec.Manifest.ConnectorID == connectorID {
			matched = append(matched, item)
		}
	}
	return matched, nil
}

// grantConnectorAccess writes the user-subject AccessControlRule that makes the
// approved connector usable by the requester, unless one already exists.
func grantConnectorAccess(req api.Context, request *v1.ConnectorAccessRequest) error {
	manifest := request.Spec.Manifest

	catalogID := manifest.MCPCatalogID
	if catalogID == "" {
		catalogID = system.DefaultCatalog
	}

	var list v1.AccessControlRuleList
	if err := req.List(&list); err != nil {
		return fmt.Errorf("failed to list access control rules: %w", err)
	}
	for _, rule := range list.Items {
		if rule.Spec.MCPCatalogID != catalogID {
			continue
		}
		if !acrGrantsConnectorToUser(rule.Spec.Manifest, manifest.ConnectorID, manifest.RequesterUserID) {
			continue
		}
		return nil // already granted
	}

	rule := v1.AccessControlRule{
		GenerateName: system.AccessControlRulePrefix,
		Namespace:    req.Namespace(),
		Finalizers:   []string{v1.AccessControlRuleFinalizer},
		Spec: v1.AccessControlRuleSpec{
			MCPCatalogID: catalogID,
			Manifest: types.AccessControlRuleManifest{
				DisplayName: fmt.Sprintf("Connector approval: %s", manifest.ConnectorName),
				Subjects: []types.Subject{
					{Type: types.SubjectTypeUser, ID: manifest.RequesterUserID},
				},
				Resources: []types.Resource{
					{Type: types.ResourceTypeMCPServerCatalogEntry, ID: manifest.ConnectorID},
				},
			},
		},
	}
	if err := req.Create(&rule); err != nil {
		return fmt.Errorf("failed to create access control rule: %w", err)
	}
	return nil
}

func acrGrantsConnectorToUser(manifest types.AccessControlRuleManifest, connectorID, userID string) bool {
	subjectMatch := false
	for _, subject := range manifest.Subjects {
		if subject.Type == types.SubjectTypeUser && subject.ID == userID {
			subjectMatch = true
			break
		}
	}
	if !subjectMatch {
		return false
	}
	for _, resource := range manifest.Resources {
		if resource.Type == types.ResourceTypeMCPServerCatalogEntry && resource.ID == connectorID {
			return true
		}
	}
	return false
}

func convertConnectorAccessRequest(request v1.ConnectorAccessRequest) types.ConnectorAccessRequest {
	return types.ConnectorAccessRequest{
		Metadata: MetadataFrom(&request),
		Manifest: request.Spec.Manifest,
	}
}

// UserHasApprovedConnectorAccess reports whether a user holds an approved
// request for the catalog entry, ignoring ACR grants.
func UserHasApprovedConnectorAccess(req api.Context, requesterUserID, connectorID string) (bool, error) {
	requests, err := connectorAccessRequestsFor(req, requesterUserID, connectorID)
	if err != nil {
		return false, err
	}
	for _, request := range requests {
		if request.Spec.Manifest.Status == types.ConnectorAccessRequestApproved {
			return true, nil
		}
	}
	return false, nil
}
