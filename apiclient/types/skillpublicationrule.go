package types

type SkillPublicationRule struct {
	Metadata
	SkillPublicationRuleManifest `json:",inline"`
}

type SkillPublicationRuleManifest struct {
	SkillID   string `json:"skillID"`
	Published bool   `json:"published"`
}

type SkillPublicationRuleList List[SkillPublicationRule]
