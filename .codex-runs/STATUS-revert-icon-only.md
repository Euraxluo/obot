# Status: revert Jobs-minimal overreach; icon-only fix

Branch: `skin/ztocc-theme`
Base: `0b4ca6d` (feat(ui): add one-click Metabase key to MCP environment)
Rejected: `44e6ee8` (feat(ui): minimal copy for Metabase key-to-MCP flow — wrong scope)

## What was reverted

`git revert --no-commit 44e6ee8` — every path that commit touched is back to its
`0b4ca6d` state (verified with `git diff 0b4ca6d --stat` over those paths: empty):

- `ui/user/messages/data_permissions/{en,ja,ko,zh-CN}.json` — full prose restored
  (`service_group_note`, `created_once`, `browser_storage_risk`, `add_to_env_done`,
  `env_attach_skipped`, `mcp_description_prefix`, full link labels); button label
  back to `一键添加到环境` / "Add to environment in one click", not `添加`
- `ui/user/src/routes/data-permissions/ApiKeysView.svelte` — service-group note,
  copy-once banner, added/skipped spans restored
- `ui/user/src/routes/data-permissions/ConnectionView.svelte` — shown-once banner
  and localStorage risk note restored
- `ui/user/src/routes/data-permissions/key-to-mcp.ts` — vMCP description back to
  `m.data_permissions_mcp_description_prefix` prose
- `ui/user/src/routes/data-permissions/page.svelte.spec.ts` — restored assertions
- `ui/user/vite.config.ts` + `ui/user/package.json` — paraglide strategy back to
  `preferredLanguage` (no forced zh-CN-first locale)
- `.codex-runs/STATUS-jobs-minimal-copy.md` — deleted (added by the reverted commit)

## The one intentional change (on top of the revert)

`ApiKeysView.svelte`, button `data-testid="metabase-add-key-to-env"`:

- Idle: text only — `{m.data_permissions_add_to_env()}` (still `一键添加到环境`)
- Loading: `<Loading class="size-4" />` only
- Lucide `Link2` import dropped (no other usage); `KeyRound`/`Plus`/`RefreshCcw` kept

Label NOT renamed. Helper prose NOT stripped. Locale strategy NOT touched.

## Verify

- zh-CN `data_permissions_add_to_env` == `一键添加到环境` (messages/data_permissions/zh-CN.json:47)
- `grep -rn Link2 ui/user/src/routes/data-permissions/` → no matches
- `pnpm --dir ui/user exec vitest run src/routes/data-permissions/page.svelte.spec.ts`
  → 1 file passed, 5 tests passed (no spec edits needed; revert restored the original spec)
