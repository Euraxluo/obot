package handlers

import (
	"strings"
	"testing"
	"time"

	"github.com/obot-platform/obot/apiclient/types"
)

func TestValidateAuditLogExportRequest(t *testing.T) {
	now := time.Now()
	valid := types.AuditLogExportCreateRequest{
		Name:      "export",
		Bucket:    "bucket",
		StartTime: types.Time{Time: now},
		EndTime:   types.Time{Time: now.Add(time.Hour)},
		Filters:   &types.AuditLogExportFilters{SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP}},
	}
	if err := (&AuditLogExportHandler{}).validateExportRequest(&valid); err != nil {
		t.Fatalf("expected valid request: %v", err)
	}
	if valid.Type != types.AuditLogTypeMCP {
		t.Fatalf("expected normalized type %q, got %q", types.AuditLogTypeMCP, valid.Type)
	}

	missingSource := valid
	missingSource.Filters = nil
	if err := (&AuditLogExportHandler{}).validateExportRequest(&missingSource); err == nil || !strings.Contains(err.Error(), "sourceTypes must include") {
		t.Fatalf("expected source-types error, got %v", err)
	}

	invalidType := valid
	invalidType.Type = "llm"
	if err := (&AuditLogExportHandler{}).validateExportRequest(&invalidType); err == nil || !strings.Contains(err.Error(), "must be") {
		t.Fatalf("expected type error, got %v", err)
	}
}

func TestValidateAuditLogExportFilters(t *testing.T) {
	tests := []struct {
		name    string
		filters types.AuditLogExportFilters
		wantErr bool
	}{
		{
			name:    "invalid source",
			filters: types.AuditLogExportFilters{SourceTypes: []types.AuditLogSourceType{"future"}},
			wantErr: true,
		},
		{
			name: "MCP filter without MCP source",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeLocalAgentToolCall},
				MCPIDs:      []string{"mcp-1"},
			},
			wantErr: true,
		},
		{
			name: "API key filter with local-agent source",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeLocalAgentToolCall},
				APIKeyIDs:   []uint{12},
			},
		},
		{
			name: "API key filter with both sources",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP, types.AuditLogSourceTypeLocalAgentToolCall},
				APIKeyIDs:   []uint{12},
			},
		},
		{
			name: "local filter without local source",
			filters: types.AuditLogExportFilters{
				SourceTypes:    []types.AuditLogSourceType{types.AuditLogSourceTypeMCP},
				AgentProviders: []string{"codex"},
			},
			wantErr: true,
		},
		{
			name: "mixed source-specific groups",
			filters: types.AuditLogExportFilters{
				SourceTypes:    []types.AuditLogSourceType{types.AuditLogSourceTypeMCP, types.AuditLogSourceTypeLocalAgentToolCall},
				MCPIDs:         []string{"mcp-1"},
				AgentProviders: []string{"codex"},
			},
			wantErr: true,
		},
		{
			name: "multi-source rejects shared-column filters",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP, types.AuditLogSourceTypeLocalAgentToolCall},
				UserIDs:     []string{"user-1"},
			},
			wantErr: true,
		},
		{
			name: "common filter requires multiple sources",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP},
				Actors:      []string{"user-1"},
			},
			wantErr: true,
		},
		{
			name: "common filters cannot combine with source-specific",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP, types.AuditLogSourceTypeLocalAgentToolCall},
				Actors:      []string{"user-1"},
				MCPIDs:      []string{"mcp-1"},
			},
			wantErr: true,
		},
		{
			name: "valid multi-source common filters",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP, types.AuditLogSourceTypeLocalAgentToolCall},
				Actors:      []string{"user-1"},
				Tools:       []string{"Bash"},
				Outcomes:    []string{"denied"},
			},
		},
		{
			name: "valid single-source shared-column filters",
			filters: types.AuditLogExportFilters{
				SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP},
				UserIDs:     []string{"user-1"},
				SessionIDs:  []string{"session-1"},
			},
		},
		{
			name: "valid local-agent filters",
			filters: types.AuditLogExportFilters{
				SourceTypes:    []types.AuditLogSourceType{types.AuditLogSourceTypeLocalAgentToolCall},
				AgentProviders: []string{"codex"},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateAuditLogExportFilters(&test.filters)
			if (err != nil) != test.wantErr {
				t.Fatalf("error = %v, wantErr = %v", err, test.wantErr)
			}
		})
	}
}

func TestValidateAuditLogExportFiltersRequiresSourceTypes(t *testing.T) {
	for _, filters := range []*types.AuditLogExportFilters{
		nil,
		{},
		{
			SourceTypes: []types.AuditLogSourceType{},
		},
	} {
		if err := validateAuditLogExportFilters(filters); err == nil {
			t.Fatalf("expected empty sourceTypes to be rejected for filters %#v", filters)
		}
	}
}

func TestValidateScheduledMCPAuditLogExportRequiresSourceTypes(t *testing.T) {
	req := types.ScheduledAuditLogExportCreateRequest{
		Name:   "schedule",
		Bucket: "bucket",
		Schedule: types.Schedule{
			Interval: "daily",
		},
	}
	if err := (&AuditLogExportHandler{}).validateScheduledExportRequest(&req); err == nil {
		t.Fatal("expected an MCP schedule without sourceTypes to be rejected")
	}

	req.Filters = &types.AuditLogExportFilters{SourceTypes: []types.AuditLogSourceType{types.AuditLogSourceTypeMCP}}
	if err := (&AuditLogExportHandler{}).validateScheduledExportRequest(&req); err != nil {
		t.Fatalf("expected an MCP schedule with sourceTypes to be valid: %v", err)
	}
}
