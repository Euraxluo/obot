package handlers

import (
	"fmt"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/skillpublicationrule"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

type SkillPublicationRuleHandler struct{}

func NewSkillPublicationRuleHandler() *SkillPublicationRuleHandler {
	return nil
}

func (*SkillPublicationRuleHandler) List(req api.Context) error {
	var list v1.SkillPublicationRuleList
	if err := req.List(&list); err != nil {
		return fmt.Errorf("failed to list skill publication rules: %w", err)
	}

	items := make([]types.SkillPublicationRule, 0, len(list.Items))
	for _, item := range list.Items {
		items = append(items, convertSkillPublicationRule(item))
	}

	return req.Write(types.SkillPublicationRuleList{Items: items})
}

func (*SkillPublicationRuleHandler) Get(req api.Context) error {
	var rule v1.SkillPublicationRule
	if err := req.Get(&rule, req.PathValue("skill_publication_rule_id")); err != nil {
		return fmt.Errorf("failed to get skill publication rule: %w", err)
	}

	return req.Write(convertSkillPublicationRule(rule))
}

func (*SkillPublicationRuleHandler) Create(req api.Context) error {
	manifest, err := readAndValidateSkillPublicationRule(req)
	if err != nil {
		return err
	}

	rule := v1.SkillPublicationRule{
		Name:      skillpublicationrule.ObjectName(manifest.SkillID),
		Namespace: req.Namespace(),
		Spec: v1.SkillPublicationRuleSpec{
			SkillID:   manifest.SkillID,
			Published: manifest.Published,
		},
	}

	if err := req.Create(&rule); err != nil {
		return fmt.Errorf("failed to create skill publication rule: %w", err)
	}

	return req.WriteCreated(convertSkillPublicationRule(rule))
}

func (*SkillPublicationRuleHandler) Update(req api.Context) error {
	manifest, err := readAndValidateSkillPublicationRule(req)
	if err != nil {
		return err
	}

	var rule v1.SkillPublicationRule
	if err := req.Get(&rule, req.PathValue("skill_publication_rule_id")); err != nil {
		return fmt.Errorf("failed to get skill publication rule: %w", err)
	}
	if rule.Spec.SkillID != manifest.SkillID {
		return types.NewErrBadRequest("skill publication rule skill ID cannot change")
	}

	rule.Spec.Published = manifest.Published
	if err := req.Update(&rule); err != nil {
		return fmt.Errorf("failed to update skill publication rule: %w", err)
	}

	return req.Write(convertSkillPublicationRule(rule))
}

func (*SkillPublicationRuleHandler) Delete(req api.Context) error {
	return req.Delete(&v1.SkillPublicationRule{
		Name:      req.PathValue("skill_publication_rule_id"),
		Namespace: req.Namespace(),
	})
}

func readAndValidateSkillPublicationRule(req api.Context) (*types.SkillPublicationRuleManifest, error) {
	var manifest types.SkillPublicationRuleManifest
	if err := req.Read(&manifest); err != nil {
		return nil, types.NewErrBadRequest("failed to read skill publication rule: %v", err)
	}
	if manifest.SkillID == "" {
		return nil, types.NewErrBadRequest("skillID is required")
	}
	if err := req.Get(&v1.Skill{}, manifest.SkillID); err != nil {
		if apierrors.IsNotFound(err) {
			return nil, types.NewErrBadRequest("skill %s not found", manifest.SkillID)
		}
		return nil, fmt.Errorf("failed to get skill %s: %w", manifest.SkillID, err)
	}

	return &manifest, nil
}

func convertSkillPublicationRule(rule v1.SkillPublicationRule) types.SkillPublicationRule {
	return types.SkillPublicationRule{
		Metadata:  MetadataFrom(&rule),
		SkillID:   rule.Spec.SkillID,
		Published: rule.Spec.Published,
	}
}
