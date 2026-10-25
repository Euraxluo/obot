# STATUS: Jobs-minimal UI copy / UX polish — skin/ztocc-theme

Base: `0b4ca6d` (feat(ui): add one-click Metabase key to MCP environment). No Go changes; `ui/user` only.

## What changed

### 1. Button label — verb only
- `data_permissions_add_to_env`: zh `一键添加到环境` → **`添加`** (matches Obot pattern `mcps_access_policies_add_server` etc.; no 「接入」 usage exists in catalogs). en `Add`, ja `追加`, ko `추가`.
- `data-testid="metabase-add-key-to-env"` unchanged. No 「一键」/「环境」 manual-speak, no subtitle.

### 2. Stripped on-page prose (ApiKeysView + ConnectionView + key-to-mcp)
Removed from render **and** deleted from all 4 locale catalogs (i18n.test key parity):
- `data_permissions_service_group_note` — group auto-create explainer under key form.
- `data_permissions_created_once` — "copy now, shown once" banner; reveal box is now key + `Copy` + `Add` + `Dismiss` only.
- `data_permissions_browser_storage_risk` — localStorage risk paragraph on Connection tab.
- `data_permissions_add_to_env_done` (`已添加到环境。`) and `data_permissions_env_attach_skipped` (`未附加 Claude 环境。`) — success row is now **MCP name + quiet `MCP` link (+ launchError if any)**.
- `data_permissions_mcp_description_prefix` — vMCP description is now just `[Key](…) · [权限](…)`; link labels renamed: `data_permissions_mcp_view_key_link` zh `Key` / en `Key` / ja `キー` / ko `키`, `data_permissions_mcp_view_group_link` zh `权限` / en `Permissions` / ja `権限` / ko `권한`.
- `data_permissions_open_vmcps` → `MCP` (all locales; proper noun).
- `data_permissions_add_to_env_failed` shortened to match the new verb (zh `添加失败：{error}`, en `Could not add: {error}`, …). `{error}` placeholder kept.
- `SERVICE_GROUP_NAME` import dropped from ApiKeysView (unused after note removal). Claude-env attach behavior in `key-to-mcp.ts` unchanged; only the "skipped" note render was dropped.
- Kept: `data_permissions_saved_key_masked` (state, not prose), error toasts, Confirm dialogs.

### 3. First visit lands zh-CN
- Paraglide strategy `['localStorage', 'preferredLanguage', 'baseLocale']` let English browsers hijack first visits via `preferredLanguage`. Changed to **`['localStorage', 'baseLocale']`** in `vite.config.ts` **and** the `i18n:compile` script in `package.json` (kept in sync per comment). localStorage stays first → LanguageSelect (`setLocale`) unaffected. Also removes the SSR(zh)/client(en) hydration mismatch.

### 4. Tests
- `page.svelte.spec.ts`: removed assertion on deleted `add_to_env_done`; added Copy/Dismiss visibility assertions on the reveal box (documents the prose-free contract). All other assertions already go through `m.*`, so the zh-CN default holds.

### 5. Lint (touched files clean)
- Fixed two pre-existing eslint errors in files this change touches: unused `Props` annotation in ApiKeysView (`let { settings }: Props = $props();`, matches `SensitiveInput.svelte` convention) and unused `loadSettings` import in ConnectionView.
- 7 errors remain on the branch, all pre-existing and out of scope here: `MarketplaceCard.svelte`, `ConnectorsMarketplace.svelte` (no-navigation-without-resolve), `TablePermissionsView.svelte` (unused Props), `metabase.ts` (preserve-caught-error), `permissions.svelte.ts` (SvelteSet).

## Verification
- `pnpm run i18n:compile` ✔ (strategy in generated runtime = localStorage, baseLocale)
- `pnpm exec vitest run src/routes/data-permissions/page.svelte.spec.ts src/lib/i18n.test.ts` → **114 passed** ✔ (re-run after final rebase of changes)
- `pnpm run check` → 0 errors, 0 warnings ✔
- `pnpm run lint` → 0 errors in touched files (7 pre-existing branch errors remain elsewhere, see §5)
- Baseline comparison via `git stash` at HEAD for the locale-strategy change: `LanguageSelect.svelte.spec.ts` + `Layout.svelte.spec.ts` fail **12 tests at HEAD and 12 with this change** (identical) — pre-existing hardcoded-English assertions under zh-CN rendering, not regressions. `src/routes/vmcps/page.svelte.spec.ts` fails **16/16** at HEAD too (matches the documented known-failures note). This change is failure-neutral in the test env.
- Full 150-file browser suite not run end-to-end: serialized browser tests exceed the background time cap; targeted + baseline-diff verification above covers the changed surfaces.

## Not done
- Screenshots: skipped — needs live Go backend + seeded Metabase; not "easy" in this pass.
- `data_permissions_saved_key_masked` left as-is (functional state indicator, not on the brief's list).
