package handlers

import (
	"archive/zip"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/obot-platform/obot/apiclient/types"
	"github.com/obot-platform/obot/pkg/api"
	"github.com/obot-platform/obot/pkg/controller/handlers/skillrepository"
	gclient "github.com/obot-platform/obot/pkg/gateway/client"
	gatewaytypes "github.com/obot-platform/obot/pkg/gateway/types"
	"github.com/obot-platform/obot/pkg/gitcredential"
	"github.com/obot-platform/obot/pkg/skillaccessrule"
	"github.com/obot-platform/obot/pkg/skillformat"
	v1 "github.com/obot-platform/obot/pkg/storage/apis/obot.obot.ai/v1"
	"github.com/obot-platform/obot/pkg/system"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	kclient "sigs.k8s.io/controller-runtime/pkg/client"
)

const (
	defaultSkillListLimit = 50
	maxSkillListLimit     = 200
	maxSkillMDBytes       = 1024 * 1024
)

type SkillHandler struct {
	maxRepoSizeMB          int
	skillAccessRuleHelper  *skillaccessrule.Helper
	materializeSkillSource func(ctx context.Context, skill *v1.Skill, token string, maxRepoSizeMB int) (func(), string, error)

	signingKeyLock sync.Mutex
	signingKey     ed25519.PrivateKey
}

type skillRepositoryCredentialRevealer interface {
	RevealCredential(context.Context, []string, string) (gatewaytypes.Credential, error)
}

func NewSkillHandler(maxRepoSizeMB int, skillAccessRuleHelper *skillaccessrule.Helper) *SkillHandler {
	return &SkillHandler{
		skillAccessRuleHelper:  skillAccessRuleHelper,
		maxRepoSizeMB:          maxRepoSizeMB,
		materializeSkillSource: skillrepository.MaterializeSkillSource,
	}
}

func revealSkillRepositoryToken(ctx context.Context, client skillRepositoryCredentialRevealer, skill *v1.Skill) (string, error) {
	if client == nil || skill.Spec.RepoID == "" {
		return "", nil
	}
	cred, err := client.RevealCredential(ctx, []string{skill.Spec.RepoID}, skillrepository.SkillRepositoryCredentialToolName)
	if err != nil {
		if errors.As(err, &gclient.CredentialNotFoundError{}) {
			return "", nil
		}
		return "", fmt.Errorf("failed to reveal credential for skill repository %s: %w", skill.Spec.RepoID, err)
	}
	return cred.Secrets[skill.Spec.RepoURL], nil
}

func (h *SkillHandler) materialize(req api.Context, skill *v1.Skill) (func(), string, error) {
	var token string
	var repository v1.SkillRepository
	err := req.Get(&repository, skill.Spec.RepoID)
	if err == nil && repository.Spec.GitCredentialID != "" {
		token, err = gitcredential.Resolve(req.Context(), req.Storage, req.GatewayClient, req.Namespace(), repository.Spec.GitCredentialID, skill.Spec.RepoURL)
	} else if err == nil || apierrors.IsNotFound(err) {
		token, err = revealSkillRepositoryToken(req.Context(), req.GatewayClient, skill)
	} else {
		err = fmt.Errorf("failed to get skill repository %s: %w", skill.Spec.RepoID, err)
	}
	if err != nil {
		return nil, "", err
	}
	return h.materializeSkillSource(req.Context(), skill, token, h.maxRepoSizeMB)
}

func (h *SkillHandler) List(req api.Context) error {
	limit, err := parseSkillListLimit(req.URL.Query().Get("limit"))
	if err != nil {
		return err
	}

	items, err := h.listVisibleSkills(req, req.URL.Query().Get("repoID"))
	if err != nil {
		return err
	}

	includeInvalid := (req.UserIsAdmin() || req.UserIsAuditor()) && req.URL.Query().Get("all") == "true"
	query := strings.ToLower(strings.TrimSpace(req.URL.Query().Get("q")))
	filtered := make([]types.Skill, 0, len(items))
	for _, item := range items {
		if !item.Status.Valid && !includeInvalid {
			continue
		}
		if query != "" && !matchesSkillQuery(item, query) {
			continue
		}
		filtered = append(filtered, convertSkill(item))
	}

	slices.SortStableFunc(filtered, func(a, b types.Skill) int {
		aName := strings.ToLower(skillSortName(a.DisplayName, a.Name))
		bName := strings.ToLower(skillSortName(b.DisplayName, b.Name))
		if cmp := strings.Compare(aName, bName); cmp != 0 {
			return cmp
		}
		return strings.Compare(a.ID, b.ID)
	})

	if len(filtered) > limit {
		filtered = filtered[:limit]
	}

	return req.Write(types.SkillList{Items: filtered})
}

func (h *SkillHandler) Get(req api.Context) error {
	skill, err := h.getAccessibleSkill(req, req.PathValue("id"))
	if err != nil {
		return err
	}

	return req.Write(convertSkill(*skill))
}

func (h *SkillHandler) Preview(req api.Context) error {
	skill, err := h.getAccessibleSkill(req, req.PathValue("id"))
	if err != nil {
		return err
	}

	cleanup, skillDir, err := h.materialize(req, skill)
	if err != nil {
		return fmt.Errorf("failed to materialize skill source: %w", err)
	}
	defer cleanup()

	skillFile := filepath.Join(skillDir, skillformat.SkillMainFile)
	f, err := os.Open(skillFile)
	if err != nil {
		if os.IsNotExist(err) {
			return types.NewErrNotFound("%s not found for skill %s", skillformat.SkillMainFile, skill.Name)
		}
		return fmt.Errorf("failed to open %s: %w", skillformat.SkillMainFile, err)
	}
	defer f.Close()

	content, err := io.ReadAll(io.LimitReader(f, maxSkillMDBytes+1))
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", skillformat.SkillMainFile, err)
	}
	if len(content) > maxSkillMDBytes {
		return types.NewErrBadRequest("%s exceeds maximum size of %d bytes", skillformat.SkillMainFile, maxSkillMDBytes)
	}

	req.ResponseWriter.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	req.WriteHeader(http.StatusOK)
	_, err = req.ResponseWriter.Write(content)
	return err
}

// downloadTokenTTL bounds how long a minted download URL stays usable. The
// token is bound to a single skill id, so a leaked command from the UI grants
// at most one skill download for this window.
const downloadTokenTTL = 15 * time.Minute

func (h *SkillHandler) Download(req api.Context) error {
	id := req.PathValue("id")
	if !h.validDownloadToken(req, id) && !req.UserIsAuthenticated() {
		return types.NewErrHTTP(http.StatusUnauthorized, "a valid download token or an authenticated session is required")
	}

	skill, err := h.getAccessibleSkill(req, id)
	if err != nil {
		return err
	}

	return h.writeSkillZip(req, skill)
}

// DownloadURL mints a short-lived signed download URL for the CLI one-line
// install commands. The request itself requires an authenticated session with
// access to the skill; the minted URL works without a session until it expires.
func (h *SkillHandler) DownloadURL(req api.Context) error {
	id := req.PathValue("id")
	skill, err := h.getAccessibleSkill(req, id)
	if err != nil {
		return err
	}

	expires := time.Now().Add(downloadTokenTTL).Unix()
	signature, err := h.signDownloadToken(req, skill.Name, expires)
	if err != nil {
		return err
	}

	return req.Write(types.SkillDownloadURL{
		Path: fmt.Sprintf("/api/skills/%s/download?expires=%d&token=%s", skill.Name, expires, signature),
	})
}

// downloadSigningKey returns the Ed25519 private key shared with the persistent
// JWT token service, revealed from the gateway credential store and cached.
func (h *SkillHandler) downloadSigningKey(req api.Context) (ed25519.PrivateKey, error) {
	h.signingKeyLock.Lock()
	defer h.signingKeyLock.Unlock()

	if h.signingKey != nil {
		return h.signingKey, nil
	}

	cred, err := req.GatewayClient.RevealCredential(req.Context(), []string{system.JWKCredentialContext}, system.JWKCredentialContext)
	if err != nil {
		return nil, fmt.Errorf("failed to reveal signing key: %w", err)
	}
	keyData, err := base64.StdEncoding.DecodeString(cred.Secrets["JWK_KEY"])
	if err != nil || len(keyData) != ed25519.PrivateKeySize {
		return nil, fmt.Errorf("signing key is missing or malformed")
	}
	h.signingKey = ed25519.PrivateKey(keyData)
	return h.signingKey, nil
}

func (h *SkillHandler) signDownloadToken(req api.Context, skillID string, expires int64) (string, error) {
	key, err := h.downloadSigningKey(req)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(ed25519.Sign(key, downloadTokenMessage(skillID, expires))), nil
}

// validDownloadToken reports whether the request carries an unexpired token
// signed for exactly this skill id.
func (h *SkillHandler) validDownloadToken(req api.Context, skillID string) bool {
	query := req.URL.Query()
	token := query.Get("token")
	expires, err := strconv.ParseInt(query.Get("expires"), 10, 64)
	if token == "" || err != nil || time.Now().Unix() > expires {
		return false
	}

	key, err := h.downloadSigningKey(req)
	if err != nil {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return false
	}
	return ed25519.Verify(key.Public().(ed25519.PublicKey), downloadTokenMessage(skillID, expires), signature)
}

func downloadTokenMessage(skillID string, expires int64) []byte {
	return []byte(fmt.Sprintf("skill-download:%s:%d", skillID, expires))
}

func (h *SkillHandler) writeSkillZip(req api.Context, skill *v1.Skill) error {
	cleanup, skillDir, err := h.materialize(req, skill)
	if err != nil {
		return fmt.Errorf("failed to materialize skill source: %w", err)
	}
	defer cleanup()

	if err := injectObotMetadata(skillDir, skill); err != nil {
		return fmt.Errorf("failed to inject obot metadata into SKILL.md: %w", err)
	}

	fileName := sanitizeDownloadFilename(skill.Spec.Name)
	if fileName == "" {
		fileName = skill.Name
	}

	req.ResponseWriter.Header().Set("Content-Type", "application/zip")
	req.ResponseWriter.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName+".zip"))
	req.WriteHeader(http.StatusOK)

	return zipSkillDirectory(skillDir, req.ResponseWriter)
}

func (h *SkillHandler) getAccessibleSkill(req api.Context, id string) (*v1.Skill, error) {
	var skill v1.Skill
	if err := req.Get(&skill, id); err != nil {
		return nil, err
	}
	if !skill.Status.Valid {
		return nil, types.NewErrNotFound("skill %s not found", id)
	}

	return &skill, nil
}

func (h *SkillHandler) listAccessibleSkills(req api.Context, repoID string) ([]v1.Skill, error) {
	allowAll, repoIDs, skillIDs, err := h.skillAccessRuleHelper.GetUserSkillAccessScope(req.User)
	if err != nil {
		return nil, err
	}
	// Allow admins/owners/auditors to bypass skill access scope with ?all=true
	if !allowAll && (req.UserIsAdmin() || req.UserIsAuditor()) && req.URL.Query().Get("all") == "true" {
		allowAll = true
	}

	if allowAll {
		return listSkills(req, repoID)
	}

	if repoID != "" {
		return h.listScopedSkillsForRepo(req, repoID, repoIDs, skillIDs)
	}

	results := make(map[string]v1.Skill, len(repoIDs)+len(skillIDs))
	for repoID := range repoIDs {
		skills, err := listSkills(req, repoID)
		if err != nil {
			return nil, err
		}
		for _, skill := range skills {
			results[skill.Name] = skill
		}
	}

	for skillID := range skillIDs {
		skill, err := getSkill(req, skillID)
		if err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return nil, err
		}
		results[skill.Name] = *skill
	}

	return mapValues(results), nil
}

func (h *SkillHandler) listVisibleSkills(req api.Context, repoID string) ([]v1.Skill, error) {
	// Open-market basic users see published skills independently of private skill
	// access rules. Admins and auditors retain the connector-market behavior of
	// seeing all listings. With the market closed, the legacy access rules remain
	// the only visibility mechanism.
	if req.UserIsAuthenticated() && marketOpenEnabled() {
		items, err := listSkills(req, repoID)
		if err != nil {
			return nil, err
		}
		if req.UserIsAdmin() || req.UserIsAuditor() {
			return items, nil
		}

		published, err := publishedSkillIDs(req)
		if err != nil {
			return nil, err
		}
		visible := make([]v1.Skill, 0, len(items))
		for _, item := range items {
			if _, ok := published[item.Name]; ok {
				visible = append(visible, item)
			}
		}
		return visible, nil
	}

	return h.listAccessibleSkills(req, repoID)
}

func publishedSkillIDs(req api.Context) (map[string]struct{}, error) {
	var rules v1.SkillPublicationRuleList
	if err := req.List(&rules); err != nil {
		return nil, fmt.Errorf("failed to list skill publication rules: %w", err)
	}

	published := make(map[string]struct{}, len(rules.Items))
	for _, rule := range rules.Items {
		if rule.Spec.Published {
			published[rule.Spec.SkillID] = struct{}{}
		}
	}
	return published, nil
}

func (h *SkillHandler) listScopedSkillsForRepo(req api.Context, repoID string, allowedRepoIDs, allowedSkillIDs map[string]struct{}) ([]v1.Skill, error) {
	if _, ok := allowedRepoIDs[repoID]; ok {
		return listSkills(req, repoID)
	}

	results := map[string]v1.Skill{}
	for skillID := range allowedSkillIDs {
		skill, err := getSkill(req, skillID)
		if err != nil {
			if apierrors.IsNotFound(err) {
				continue
			}
			return nil, err
		}
		if skill.Spec.RepoID != repoID {
			continue
		}
		results[skill.Name] = *skill
	}

	return mapValues(results), nil
}

func listSkills(req api.Context, repoID string) ([]v1.Skill, error) {
	var (
		list v1.SkillList
		opts []kclient.ListOption
	)

	if repoID != "" {
		opts = append(opts, kclient.MatchingFields{"spec.repoID": repoID})
	}
	if err := req.List(&list, opts...); err != nil {
		if repoID != "" {
			return nil, fmt.Errorf("failed to list skills for repository %s: %w", repoID, err)
		}
		return nil, fmt.Errorf("failed to list skills: %w", err)
	}

	return list.Items, nil
}

func getSkill(req api.Context, skillID string) (*v1.Skill, error) {
	var skill v1.Skill
	if err := req.Get(&skill, skillID); err != nil {
		return nil, err
	}
	return &skill, nil
}

func mapValues(values map[string]v1.Skill) []v1.Skill {
	return slices.Collect(maps.Values(values))
}

func parseSkillListLimit(raw string) (int, error) {
	if raw == "" {
		return defaultSkillListLimit, nil
	}

	limit, err := strconv.Atoi(raw)
	if err != nil || limit < 1 {
		return 0, types.NewErrBadRequest("invalid limit: %s", raw)
	}
	if limit > maxSkillListLimit {
		return maxSkillListLimit, nil
	}
	return limit, nil
}

func matchesSkillQuery(skill v1.Skill, query string) bool {
	return strings.Contains(strings.ToLower(skill.Spec.Name), query) ||
		strings.Contains(strings.ToLower(skill.Spec.DisplayName), query) ||
		strings.Contains(strings.ToLower(skill.Spec.Description), query)
}

func skillSortName(displayName, name string) string {
	if displayName != "" {
		return displayName
	}
	return name
}

func injectObotMetadata(skillDir string, skill *v1.Skill) error {
	skillFile := filepath.Join(skillDir, skillformat.SkillMainFile)
	content, err := os.ReadFile(skillFile)
	if err != nil {
		return fmt.Errorf("failed to read %s: %w", skillformat.SkillMainFile, err)
	}

	fm, body, err := skillformat.ParseFrontmatter(string(content))
	if err != nil {
		return fmt.Errorf("failed to parse %s frontmatter: %w", skillformat.SkillMainFile, err)
	}

	if fm.Metadata == nil {
		fm.Metadata = make(map[string]string)
	}
	fm.Metadata["obot-skill-id"] = skill.Name
	fm.Metadata["obot-skill-repository-id"] = skill.Spec.RepoID
	fm.Metadata["obot-commit-sha"] = skill.Spec.CommitSHA
	fm.Metadata["obot-indexed-at"] = skill.Status.LastIndexedAt.UTC().Format("2006-01-02T15:04:05Z")

	output, err := skillformat.FormatSkillMD(fm, body)
	if err != nil {
		return fmt.Errorf("failed to format %s: %w", skillformat.SkillMainFile, err)
	}

	if err := os.WriteFile(skillFile, []byte(output), 0644); err != nil {
		return fmt.Errorf("failed to write %s: %w", skillformat.SkillMainFile, err)
	}

	return nil
}

func zipSkillDirectory(skillDir string, w io.Writer) error {
	writer := zip.NewWriter(w)

	err := filepath.WalkDir(skillDir, func(currentPath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if currentPath == skillDir {
			return nil
		}
		if entry.Type()&fs.ModeSymlink != 0 {
			relPath, err := filepath.Rel(skillDir, currentPath)
			if err != nil {
				relPath = currentPath
			}
			return fmt.Errorf("symbolic links are not allowed in skill contents: %s", filepath.ToSlash(relPath))
		}
		if entry.IsDir() {
			return nil
		}

		relPath, err := filepath.Rel(skillDir, currentPath)
		if err != nil {
			return fmt.Errorf("failed to determine ZIP path for %s: %w", currentPath, err)
		}

		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("failed to stat %s: %w", currentPath, err)
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return fmt.Errorf("failed to build ZIP header for %s: %w", currentPath, err)
		}
		header.Name = filepath.ToSlash(relPath)
		header.Method = zip.Deflate

		fileWriter, err := writer.CreateHeader(header)
		if err != nil {
			return fmt.Errorf("failed to create ZIP entry for %s: %w", currentPath, err)
		}

		file, err := os.Open(currentPath)
		if err != nil {
			return fmt.Errorf("failed to open %s: %w", currentPath, err)
		}

		_, copyErr := io.Copy(fileWriter, file)
		closeErr := file.Close()
		if copyErr != nil {
			return fmt.Errorf("failed to write ZIP entry for %s: %w", currentPath, copyErr)
		}
		if closeErr != nil {
			return fmt.Errorf("failed to close %s: %w", currentPath, closeErr)
		}

		return nil
	})
	if err != nil {
		writer.Close()
		return err
	}

	if err := writer.Close(); err != nil {
		return fmt.Errorf("failed to finalize skill ZIP: %w", err)
	}

	return nil
}

func sanitizeDownloadFilename(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	var b strings.Builder
	lastDash := false
	for _, ch := range strings.ToLower(value) {
		if (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9') || ch == '-' || ch == '_' {
			b.WriteRune(ch)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}

	return strings.Trim(b.String(), "-")
}

func convertSkill(skill v1.Skill) types.Skill {
	return types.Skill{
		Metadata:        MetadataFrom(&skill),
		SkillManifest:   skill.Spec.SkillManifest,
		RepoID:          skill.Spec.RepoID,
		RepoURL:         skill.Spec.RepoURL,
		RepoRef:         skill.Spec.RepoRef,
		CommitSHA:       skill.Spec.CommitSHA,
		RelativePath:    skill.Spec.RelativePath,
		InstallHash:     skill.Spec.InstallHash,
		Valid:           skill.Status.Valid,
		ValidationError: skill.Status.ValidationError,
		LastIndexedAt:   *types.NewTime(skill.Status.LastIndexedAt.Time),
	}
}
