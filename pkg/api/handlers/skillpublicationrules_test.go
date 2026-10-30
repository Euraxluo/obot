package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/skillpublicationrule"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

func TestSkillPublicationRuleHandler(t *testing.T) {
	skill := &v1.Skill{
		Name:      "sk1",
		Namespace: system.DefaultNamespace,
		Status:    v1.SkillStatus{Valid: true},
	}
	storage := newFakeStorage(t, skill)
	handler := &SkillPublicationRuleHandler{}

	create := func(t *testing.T, body string) types.SkillPublicationRule {
		t.Helper()
		req := httptest.NewRequest(http.MethodPost, "/api/skill-publication-rules", strings.NewReader(body))
		req.SetPathValue("skill_publication_rule_id", "")
		rec := httptest.NewRecorder()
		require.NoError(t, handler.Create(api.Context{
			ResponseWriter: rec,
			Request:        req,
			Storage:        storage,
		}))
		require.Equal(t, http.StatusCreated, rec.Code)
		var rule types.SkillPublicationRule
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &rule))
		return rule
	}

	rule := create(t, `{"skillID":"sk1","published":true}`)
	assert.Equal(t, skillpublicationrule.ObjectName("sk1"), rule.ID)
	assert.True(t, rule.Published)

	created := &v1.SkillPublicationRule{}
	require.NoError(t, storage.Get(
		t.Context(),
		kclient.ObjectKey{Namespace: system.DefaultNamespace, Name: rule.ID},
		created,
	))
	assert.True(t, created.Spec.Published)

	req := httptest.NewRequest(http.MethodPut, "/api/skill-publication-rules/"+rule.ID, strings.NewReader(`{"skillID":"sk1"}`))
	req.SetPathValue("skill_publication_rule_id", rule.ID)
	rec := httptest.NewRecorder()
	require.NoError(t, handler.Update(api.Context{
		ResponseWriter: rec,
		Request:        req,
		Storage:        storage,
	}))
	require.Equal(t, http.StatusOK, rec.Code)
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &rule))
	assert.False(t, rule.Published)
}
