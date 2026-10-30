# LLM removal dependency inventory

Baseline: `skin/ztocc-theme` at `cb54459` (Task E backend/UI removals already merged). This inventory is the implementation gate for Task F. Product scope is the internal, non-commercial MCP + Skills edition; no LLM gateway, model management, or LLM conversation surface is product scope.

## Removal map

### Embedded LLM gateway and model data

- Delete `pkg/llmengine` and its tests. It is referenced by service bootstrapping, gateway proxying, model sync/migration, provider configuration revisioning, the LLM guardrail plugins, and one model-access test.
- Delete embedded gateway setup in `pkg/services/config.go`: `BifrostEngine`, `LLMGateway*`, model-data URL refresh/`modeldata.RefreshURL`, startup task wiring, provider dispatcher model registration, and shared gateway lock/settings setup.
- Delete gateway HTTP proxy and metering files: `pkg/gateway/server/llmproxy*`, `pkg/gateway/server/llmusage*`, model-provider dispatch helpers in `pkg/gateway/server/dispatcher/{availablemodels,builtinmodelprovider,modelconfiguration}.go`, LLM gateway budgets/settings/locks in `pkg/gateway/client`, and the LLM audit/usage code used only by that path.
- Delete LLM gateway management API: `pkg/api/handlers/{llmgateway,llmgatewayidentity}.go`, `/api/llm-gateway/**` routes, budget/pricing/settings/sync/admin proxy handlers, and their authz rules/tests.
- Delete `/api/llm-proxy/**` handling and authz. General gateway API keys, OAuth/token infrastructure, MCP audit, and MCP proxying must remain.
- Delete model catalog CRDs/controllers/handlers/routes: `Model`, `ModelProvider`, `ModelInfo`, `ModelInfoSource`, `DefaultModelAlias`, and `ModelAccessPolicy`, plus model listing/refresh/default-alias APIs and controller reconciliation. Existing model access data is no longer readable by this product surface.
- Keep provider configuration change/daemon-sync resources only to the extent needed by auth providers and SCIM. Remove model-provider and LLM-gateway provider types/revisions from the shared contracts and tests.

### Model proxy and MCP Tester

- Delete `pkg/mcptester/{modelproxy,model,proxy,request,normalize,usage}.go`, `pkg/api/handlers/{modelproxy,mcptester_modelproxy}.go`, `/api/model-proxy/**`, `/api/vmcp-instances/{id}/tester/chat`, and chat-only types in `apiclient/types/mcptester.go`.
- Keep the pure MCP Tester: direct MCP initialize/tools/prompts/resources calls and the corresponding browser-side `MCPTesterSession`. Remove the Chat tab, composer/model stream state, chat-only API schemas, tests, and “use in chat” copy. This tester does not need an LLM to prove an MCP connection.

### Conversation resources and marketplace experts

- At this baseline there are no `Project`, `Thread`, `Assistant`, or assistant chat REST resources/routes in `pkg` or `ui/user/src/routes`; no action is possible beyond the model/chat removals above.
- The marketplace “experts” tab is a list of shared vMCPs, not a separate assistant resource. Remove only the marketplace experts tab/data-fetch/search grouping and preserve the full vMCP administration/routes. Market defaults to Skills and exposes exactly Skills + Connectors.
- Hosted Claude environments and `AgentInstance` are local runner/session management, not the removed legacy Project/Thread/Assistant objects. They are outside Task F's named LLM/chat resource scope; only their LLM-proxy/model dependencies may be cut.

### Model UI and governance views

- Delete `ui/user/src/routes/models/**`, `ui/user/src/routes/llm-gateway/**`, model-provider/model-access redirects under admin routes, `lib/services/llm-gateway/**`, `lib/components/llm-gateway/**`, admin models context/store/services, and model navigation/setup references.
- Remove model-only identity/SCIM current-access cards and model-policy cleanup behavior while preserving users, groups, roles, SCIM, skill access, and MCP access.
- Remove LLM-only guardrail/message-policy/profile views and LLM audit routes/exports. Preserve MCP guardrails and MCP audit/export.
- Remove obsolete model/chat i18n catalogs and keys after affected components are gone; regenerate Paraglide output through the normal check command.

## Cross-points and hard gates

1. **Shared provider registry**: `dispatcher.Dispatcher` serves both auth providers and model providers, and `provider.Handler` reads both manifests. Cut model methods/types/registration while retaining local auth provider startup and SCIM configuration.
2. **ProviderConfigurationChange / ProviderSync**: also implement auth provider switches and SCIM migration. Remove model and LLM-gateway cases/revisions, not the resource reconciliation needed by auth/SCIM.
3. **Guardrails**: the same engine and provider integrations support MCP tool-call traffic and LLM request/response traffic. Preserve `GuardrailTargetMCP`, MCP routes/policies, and API-key scoping; remove `GuardrailTargetLLM`, LLM plugins, LLM profiles/budgets, message-policy AI judge, and LLM-only handlers/tests.
4. **SCIM and identity cleanup**: SCIM references can currently include model access policies. Remove only model references/list kinds while preserving group/user subject cleanup and all RBAC/SCIM behavior.
5. **Audit**: LLM audit is produced only by LLM proxying. Preserve MCP and local-agent tool-call audit plus general scheduled-export infrastructure; remove `AuditLogTypeLLM`, its filters/views/routes, and gateway tables/code that only serve it.
6. **API keys and agent auth scopes**: gateway API-key machinery is shared by MCP clients and local agent identities. Preserve it; remove only LLM route group/scope behavior and LLM-only usage presentation.
7. **vMCP and marketplace**: shared vMCP data powers both expert cards and the retained vMCP feature. Remove only the experts tab and search/data presentation; never delete vMCP APIs/controllers.
8. **MCP Tester**: the session/client directly exercises MCP capabilities without a model. Preserve it; remove only the model continuation route/UI.

## Generated contracts and validation gate

- Remove obsolete `apiclient/types` model/LLM contracts, then run `go generate` to refresh deepcopy/OpenAPI artifacts.
- Required implementation gates: `go build ./...`; `go test ./pkg/... -count=1`; `pnpm --dir ui/user run check`; affected Vitest marketplace/MCP tester/model-removal specs. Browser sanity on port 8080 must verify two marketplace tabs, absent Experts/Models navigation, and working MCP Servers + Skills pages.
