# Fix: 表权限下拉空白 + 新建 Group UI

- Branch: `skin/ztocc-theme`
- Scope: frontend-only
- Status: complete

## Changes

- `view-data` now uses Metabase-compatible `unrestricted` / `blocked`; legacy `all` is normalized for display.
- Table-level permission objects resolve to non-blank View/Create values, with database values inherited when a table has no granular override.
- Granular table writes preserve schema/table structure and use `{ view-data: { read } }` / `{ create-queries: { query } }`.
- Added localized New Group input and Create Group action on Table Permissions; creation refreshes groups and selects the new group.
- Preserved API-key service-group auto-creation and localStorage behavior.

## Verification

- `pnpm --dir ui/user run check` — passed.
- `pnpm --dir ui/user exec vitest run --browser.headless src/routes/data-permissions/page.svelte.spec.ts` — passed (3 tests).
- Browser regression coverage verifies:
  - DB-level `unrestricted` and `query-builder-and-native` display correctly.
  - Granular table objects display correctly.
  - A new group is posted, group list refreshes, and the new group is selected.
  - Permission changes still PUT through the graph with revision.

## Not Separately Verified

- Live manual page walkthrough against `http://127.0.0.1:5174` was not rerun; the equivalent browser UI flows are covered by the targeted Vitest browser test.
