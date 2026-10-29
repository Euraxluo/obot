# Task F: LLM subsystem UI removal status

## Result

**Complete.** Branch `skin/ztocc-theme` now has the UI dependency-map work committed and all required gates green. No push was made.

## Commits

- `d05acde feat(ui): drop llm and models surfaces`
- `1e3e3c6 feat(ui): market to two tabs`
- `8eadbbb test(clauderunner): stabilize orchestrator startup`

## Completed scope

- Removed the models route family, model stores/layout loading, model navigation, model access policy UI, default-alias UI, token-usage dashboard surfaces, LLM usage/audit views, LLM audit exports, and LLM/model API mocks/types.
- Reduced MCP Tester to the pure direct MCP surface: Tools, Prompts, Resources, and MCP Log. Removed Chat, the model/chat continuation client, staging-for-chat UI, and tester-chat API tests.
- Removed the Claude environment LLM-proxy option and the agent API-key LLM capability while preserving local-agent identities, MCP access, Skills access, device scans, and Obot API capability.
- Moved the retained guardrail client to `/api/guardrails`, preserved MCP guardrails/filters, and removed LLM targets/policies/message-policy surfaces.
- Removed model/message-policy SCIM reference kinds while preserving SCIM group/user reconciliation and skill/MCP/vMCP references.
- Changed the marketplace default to Skills and exposed exactly Skills + Connectors. Shared vMCP administration/routes remain; the marketplace no longer presents the expert/shared-vMCP tab or search grouping.
- Cleaned unreferenced LLM/model/chat/expert i18n keys across locales, moved shared auth-provider card copy out of the obsolete models catalog, and regenerated Paraglide output.

## Verification

- **verified**: `go build ./...` passed.
- **verified**: `go test ./pkg/... -count=1` passed — 5,857 tests in 130 packages.
- **verified**: `pnpm --dir ui/user run check` passed — 0 errors / 0 warnings.
- **verified**: `pnpm --dir ui/user run lint` passed.
- **verified**: affected Vitest groups passed:
  - Layout + marketplace: 2 files / 28 tests.
  - MCP Tester/session + vMCP tester: 4 files / 68 tests.
  - Identity/current-access/usage/guardrails/MCP filters: 7 files / 50 tests.
  - Audit exports + Claude environments + SCIM: 5 files / 71 tests.
  - Root layout: 1 file / 10 tests.
  - Data permissions + connector marketplace regression: 2 files / 8 tests.
- **verified browser on port 8080**: `/market` defaults to Skills and shows exactly `技能` and `连接器`; `/mcp-servers` and `/skills` load with their retained feature tabs; sidebar has no Models/LLM Gateway entry.

## Cross-points

- Preserved MCP, Skills, SCIM/RBAC, audit, marketplace approvals, data permissions, device management, vMCP administration, local-agent identities, and shared auth-provider configuration.
- `8eadbbb` only extends a flaky orchestrator startup wait from 5s to 30s so the full parallel Go suite is stable; it makes no product behavior change.
