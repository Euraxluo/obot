package v1

import (
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

type SkillPublicationRule struct {
	metav1.TypeMeta   `json:",inline"`
	metav1.ObjectMeta `json:"metadata"`

	Spec   SkillPublicationRuleSpec `json:"spec"`
	Status EmptyStatus              `json:"status"`
}

type SkillPublicationRuleSpec struct {
	SkillID   string `json:"skillID"`
	Published bool   `json:"published"`
}

// +k8s:deepcopy-gen:interfaces=k8s.io/apimachinery/pkg/runtime.Object

type SkillPublicationRuleList struct {
	metav1.TypeMeta `json:",inline"`
	metav1.ListMeta `json:"metadata"`

	Items []SkillPublicationRule `json:"items"`
}

func (in *SkillPublicationRule) GetColumns() [][]string {
	return [][]string{
		{"Name", "Name"},
		{"Skill", "Spec.SkillID"},
		{"Published", "Spec.Published"},
	}
}
