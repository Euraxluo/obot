import { m } from '$lib/i18n';
import { UserService } from '$lib/services';
import type { MCPCatalogEntry, VMCPComponent } from '$lib/services';
import { catalogEntryToVMCPComponent } from '$lib/services/vmcps/utils';

// Catalog entryKeys of the Metabase MCP servers shipped with the ztocc catalog.
const METABASE_ENTRY_KEYS = ['obot-metabase', 'obot-metabase-mcp-server'];
const METABASE_DISPLAY_SUFFIX = 'Metabase';
export const METABASE_URL_KEY = 'METABASE_URL';
export const METABASE_API_KEY_KEY = 'METABASE_API_KEY';

export interface MetabaseMcpCreationResult {
	id: string;
	displayName: string;
	launchError?: string;
	environmentAttached: boolean;
}

export function apiKeysViewURL(keyName?: string): string {
	const params = new URLSearchParams({ view: 'api-keys' });
	if (keyName) params.set('keyName', keyName);
	return `/data-permissions?${params.toString()}`;
}

export function tablePermissionsViewURL(groupId?: number): string {
	const params = new URLSearchParams({ view: 'table-permissions' });
	if (groupId !== undefined) params.set('group', String(groupId));
	return `/data-permissions?${params.toString()}`;
}

export function buildMetabaseMcpDescription(keyName: string, groupId?: number): string {
	const keyLink = `[${m.data_permissions_mcp_view_key_link()}](${apiKeysViewURL(keyName)})`;
	const groupLink = `[${m.data_permissions_mcp_view_group_link()}](${tablePermissionsViewURL(groupId)})`;
	return `${keyLink} · ${groupLink}`;
}

// The Metabase MCP runs inside Obot's container runtime, so a browser-local
// Metabase URL is rewritten to the Docker host alias the catalog uses by default.
export function metabaseUrlForMcp(baseUrl: string): string {
	try {
		const url = new URL(baseUrl);
		if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
			url.hostname = 'host.docker.internal';
		}
		return url.toString().replace(/\/+$/, '');
	} catch {
		return baseUrl;
	}
}

export function findMetabaseCatalogEntry(entries: MCPCatalogEntry[]): MCPCatalogEntry | undefined {
	for (const key of METABASE_ENTRY_KEYS) {
		const match = entries.find((entry) => entry.id.toLowerCase().includes(key));
		if (match) return match;
	}
	return entries.find((entry) => (entry.manifest.name ?? '').trim().toLowerCase() === 'metabase');
}

export function uniqueMetabaseDisplayName(keyName: string, existingNames: Set<string>): string {
	const base = `${keyName.trim()} ${METABASE_DISPLAY_SUFFIX}`;
	if (!existingNames.has(base.toLowerCase())) return base;
	let counter = 2;
	let candidate = `${base} ${counter}`;
	while (existingNames.has(candidate.toLowerCase())) {
		counter += 1;
		candidate = `${base} ${counter}`;
	}
	return candidate;
}

function metabaseComponentForEntry(
	entry: MCPCatalogEntry,
	envs: Record<string, string>
): VMCPComponent {
	const component = catalogEntryToVMCPComponent(entry);
	const other = (component.configuration ?? []).filter((policy) => !(policy.key in envs));
	component.configuration = [
		...other,
		...Object.entries(envs).map(([key, value]) => ({ key, policy: 'fixed' as const, value }))
	];
	return component;
}

async function attachToClaudeEnvironment(vmcpID: string): Promise<boolean> {
	try {
		const config = await UserService.getClaudeConfig();
		if (!config.enabled) return false;
		const environment = config.environments?.find((candidate) => candidate.profiles.length > 0);
		const profile = environment?.profiles[0];
		if (!environment || !profile) return false;
		const ids = profile.mcpServerIDs ?? [];
		if (ids.includes(vmcpID)) return true;
		await UserService.updateClaudeEnvironment(environment.id, {
			...environment,
			profiles: environment.profiles.map((candidate) =>
				candidate === profile ? { ...candidate, mcpServerIDs: [...ids, vmcpID] } : candidate
			)
		});
		return true;
	} catch {
		// Claude environments are optional; the vMCP works without one.
		return false;
	}
}

export async function createMetabaseMcpForKey(options: {
	keyName: string;
	apiKey: string;
	metabaseUrl: string;
	groupId?: number;
}): Promise<MetabaseMcpCreationResult> {
	const keyName = options.keyName.trim();
	if (!keyName || !options.apiKey) {
		throw new Error(m.data_permissions_add_to_env_failed({ error: 'missing key' }));
	}

	const [entries, existingVmcps] = await Promise.all([
		UserService.listMCPs(),
		UserService.listVMCPs()
	]);
	const entry = findMetabaseCatalogEntry(entries);
	if (!entry) {
		throw new Error(m.data_permissions_mcp_entry_missing());
	}

	const displayName = uniqueMetabaseDisplayName(
		keyName,
		new Set(existingVmcps.map((vmcp) => vmcp.displayName.toLowerCase()))
	);

	const created = await UserService.createVMCP({
		displayName,
		description: buildMetabaseMcpDescription(keyName, options.groupId),
		components: [
			metabaseComponentForEntry(entry, {
				[METABASE_URL_KEY]: metabaseUrlForMcp(options.metabaseUrl),
				[METABASE_API_KEY_KEY]: options.apiKey
			})
		]
	});

	const launch = await UserService.validateSingleOrRemoteMcpServerLaunched(created.id);
	const environmentAttached = await attachToClaudeEnvironment(created.id);

	return {
		id: created.id,
		displayName: created.displayName || displayName,
		launchError: launch.success ? undefined : launch.message,
		environmentAttached
	};
}
