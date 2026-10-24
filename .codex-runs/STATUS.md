# ZTOCC Branding + zh-CN Default Status

## Scope

- Branch: `skin/ztocc-theme`
- Added configurable platform display name (`displayName`) with default `ZTOCC`.
- Changed Paraglide `baseLocale` and initial HTML language from `en` to `zh-CN`.
- Preserved the locale strategy `localStorage -> preferredLanguage -> baseLocale`; saved locale preferences continue to win.
- No auth, permission, MCP, or feature-behavior changes beyond the app preferences field and branding presentation.

## Main Files

- Backend preference contract: `apiclient/types/apppreferences.go`, `pkg/storage/apis/obot.obot.ai/v1/apppreferences.go`, `pkg/api/handlers/apppreferences.go`
- Generated deep-copy updates: `apiclient/types/zz_generated.deepcopy.go`, `pkg/storage/apis/obot.obot.ai/v1/zz_generated.deepcopy.go`
- Frontend preference contract/default: `ui/user/src/lib/services/admin/types.ts`, `ui/user/src/lib/services/user/types.ts`, `ui/user/src/lib/stores/appPreferences.svelte.ts`
- Branding helper/title consumption: `ui/user/src/lib/branding.svelte.ts` and route/component `<title>` usages
- Branding UI: `ui/user/src/routes/admin/platform/BrandingConfigurationSidebar.svelte`, `BrandingView.svelte`
- Login/i18n fragments: `ui/user/messages/**/*.json`
- Locale default: `ui/user/project.inlang/settings.json`, `ui/user/src/app.html`, `ui/user/src/lib/i18n.test.ts`
- Regression coverage: `ui/user/src/routes/admin/platform/page.svelte.spec.ts`, `ui/user/src/tests/mocks/data.ts`

## How `displayName` Works

1. Open **Platform -> Branding**.
2. Enter the desired value under **Platform Name** (shown below Mode and above theme/logo controls).
3. Select **Save**. The UI sends `PUT /api/app-preferences` with `displayName`, persists it in `AppPreferencesSpec`, and immediately updates page titles/login copy.
4. Empty or whitespace-only input is compiled back to `ZTOCC`; **Restore Default** also returns the name to `ZTOCC`.

Titles use `productTitle(suffix)`, which reads `appPreferences.current.displayName`. Login heading/welcome messages use translated fragments with `{name}`.

## Verification

- **verified**: `cd ui/user && pnpm run i18n:compile` succeeds; generated runtime reports `baseLocale = "zh-CN"` and retains `localStorage`, `preferredLanguage`, `baseLocale`.
- **verified**: `cd ui/user && pnpm run check` passes (0 errors / 0 warnings).
- **verified**: `cd ui/user && pnpm exec vitest run src/routes/admin/platform/page.svelte.spec.ts src/lib/i18n.test.ts --browser.headless` passes 120 tests. Coverage includes editing/saving `displayName` through Branding UI and all locale catalogs matching the zh-CN base keys/placeholders.
- **verified**: `go test ./pkg/api/handlers ./pkg/storage/apis/obot.obot.ai/v1` passes (1168 tests), and `cd apiclient && go test ./types` passes (276 tests).
- **verified**: `git diff --check` passes.
- **observed**: standalone `tsc --noEmit` still reports pre-existing project errors in unrelated Svelte exported-type/test-helper files; `pnpm run check` is the project's Svelte-aware gate and passes.
- **partial**: Fresh real-browser language behavior was not manually screenshotted. The generated runtime and compiled strategy were verified; a no-localStorage browser visit should be checked if visual acceptance is required.

## Risks

- Existing preference objects omit `displayName`; the frontend compiles them to `ZTOCC`, so the deployment default remains stable.
- Some long marketing/prose references to Obot remain intentionally untouched where they describe the upstream product or non-title text.
- PR/i18n catalogs are key-synchronized; future title fragments must be added to all four locales.

## Branch/PR

- Local commit pending on `skin/ztocc-theme`.
- Remote is `Euraxluo/obot` (`origin`). Existing PR: https://github.com/Euraxluo/obot/pull/1
