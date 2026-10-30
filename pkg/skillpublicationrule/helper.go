package skillpublicationrule

import (
	"crypto/sha256"
	"encoding/hex"

	"github.com/obot-platform/obot/pkg/system"
)

// ObjectName derives a stable rule name from the stable Skill object name. Keeping
// the rule independent of Skill objects lets repository scans replace Skill specs
// without losing publication state.
func ObjectName(skillID string) string {
	digest := sha256.Sum256([]byte(skillID))
	return system.SkillPublicationRulePrefix + "-" + hex.EncodeToString(digest[:])[:16]
}
