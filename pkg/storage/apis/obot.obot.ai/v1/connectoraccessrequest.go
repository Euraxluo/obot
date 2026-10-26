package v1

import (
	"slices"

	"github.com/obot-platform/nah/pkg/fields"
	"github.com/obot-platform/obot/apiclient/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

var (
	_ fields.Fields = (*ConnectorAccessRequest)(nil)
)

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

type ConnectorAccessRequest struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata"`

	Spec   ConnectorAccessRequestSpec `json:"spec"`
	Status EmptyStatus                `json:"status"`
}

type ConnectorAccessRequestSpec struct {
	Manifest types.ConnectorAccessRequestManifest `json:"manifest"`
}

func (in *ConnectorAccessRequest) Has(field string) (exists bool) {
	return slices.Contains(in.FieldNames(), field)
}

func (in *ConnectorAccessRequest) Get(field string) (value string) {
	switch field {
	case "spec.requesterUserID":
		return in.Spec.Manifest.RequesterUserID
	case "spec.connectorID":
		return in.Spec.Manifest.ConnectorID
	case "spec.status":
		return in.Spec.Manifest.Status
	}
	return ""
}

func (in *ConnectorAccessRequest) FieldNames() []string {
	return []string{
		"spec.requesterUserID",
		"spec.connectorID",
		"spec.status",
	}
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

type ConnectorAccessRequestList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata"`

	Items []ConnectorAccessRequest `json:"items"`
}

func (in *ConnectorAccessRequest) GetColumns() [][]string {
	return [][]string{
		{"Name", "Name"},
		{"Requester", "Spec.Manifest.RequesterUsername"},
		{"Connector", "Spec.Manifest.ConnectorID"},
		{"Status", "Spec.Manifest.Status"},
	}
}
