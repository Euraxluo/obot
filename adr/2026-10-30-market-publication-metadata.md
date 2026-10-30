# 2026-10-30: Curate marketplace listings with catalog-entry metadata

- **Status:** Accepted
- **Date:** 2026-10-30
- **Supersedes:** None
- **Superseded by:** None

## Related issues

None.

## Related ODPs

None.

## Context

When `OBOT_MARKET_OPEN=true`, every authenticated user could see every catalog entry.
Administrators needed to choose which entries reach the terminal user marketplace,
individually and in bulk, without introducing a second catalog or a new API resource.
Catalog entries may be admin-created or synced from a Git source, and a source sync
must not overwrite an administrator's publishing choice.

## Decision

Marketplace publication is stored as `manifest.metadata.marketPublished` with the
string values `"true"` and `"false"`; an absent value means unpublished. This follows
the existing catalog-entry metadata convention and needs no storage or API changes.

Only administrators may set or change the value. Other users may submit the current
value unchanged, and omitting the field preserves the stored value. A Git-managed
entry accepts an update that changes only this metadata field; every other edit still
requires an editable entry. Catalog sync strips the field from source manifests and
carries the existing value forward across syncs, so publication stays Obot-local.

When the market mode is open, an authenticated non-admin sees a shared-catalog entry
only if it is published. Admins and auditors keep the full catalog view, and personal
workspace entries keep their existing access-control-rule visibility. When the flag is
off, listing behavior is unchanged.

Publication is visibility only. Connector approval, access control rules, and the
`requireConnectorApproval` connection gate are unchanged.

## Rationale

Metadata on the existing entry keeps list, detail, and update flows on the same
resource and makes individual and bulk toggles simple manifest updates. Persisting the
flag in a separate resource would add lifecycle and cleanup work without changing the
user-facing behavior. Preserving the value during sync is required because catalog
sources describe connectors, not which of them an Obot deployment chooses to publish.

## Consequences

Marketplace publication follows an entry across catalog updates and detach/ownership
changes. Deployments that seed entries must opt in explicitly; there is no implicit
publication. Future catalog tooling that rewrites manifests must preserve unknown
metadata to avoid dropping the flag, and administrators should treat catalog source
edits as unable to publish entries on their own.

## References

- `apiclient/types/mcpserver.go`
- `pkg/api/handlers/mcp.go`
- `pkg/api/handlers/mcpcatalogs.go`
- `pkg/controller/handlers/mcpcatalog/mcpcatalog.go`
