export interface MetabaseSettings {
	baseUrl: string;
	adminApiKey: string;
}

export interface MetabaseGroup {
	id: number;
	name: string;
}

export interface MetabaseApiKey {
	id: number;
	name: string;
	masked_key?: string;
	group?: { id: number; name: string };
	updated_by?: { id: number; common_name?: string };
	created_at?: string;
	updated_at?: string;
}

export interface MetabaseTable {
	id: number;
	display_name?: string;
	name: string;
	schema?: string;
}

export interface MetabaseDatabase {
	id: number;
	name: string;
	tables?: MetabaseTable[];
}

export type PermissionValue =
	| 'unrestricted'
	| 'blocked'
	| 'none'
	| 'no'
	| 'query-builder'
	| 'query-builder-and-native';

export type TablePermissionValue = 'all' | 'none' | 'no' | 'blocked';

type PermissionGraphValue = string | Record<string, unknown>;

export interface PermissionDatabaseGraph {
	'view-data'?: PermissionGraphValue;
	'create-queries'?: PermissionGraphValue;
	[key: string]: unknown;
}

export interface PermissionGraph {
	revision: number;
	groups: Record<string, Record<string, PermissionDatabaseGraph> | undefined>;
	[key: string]: unknown;
}

export const STORAGE_KEY = 'obot.metabase.admin';
export const DEFAULT_METABASE_URL = 'http://127.0.0.1:3000';
export const SERVICE_GROUP_NAME = 'ztocc_service_group';

export function loadSettings(): MetabaseSettings {
	if (typeof window === 'undefined') return { baseUrl: '', adminApiKey: '' };
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return { baseUrl: '', adminApiKey: '' };
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return { baseUrl: '', adminApiKey: '' };
		const value = parsed as Record<string, unknown>;
		return {
			baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
			adminApiKey: typeof value.adminApiKey === 'string' ? value.adminApiKey : ''
		};
	} catch {
		return { baseUrl: '', adminApiKey: '' };
	}
}

export function saveSettings(settings: MetabaseSettings): void {
	window.localStorage.setItem(
		STORAGE_KEY,
		JSON.stringify({
			baseUrl: normalizeBaseUrl(settings.baseUrl),
			adminApiKey: settings.adminApiKey
		})
	);
}

export function normalizeBaseUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

export function isLikelyCorsOrNetworkError(error: unknown): boolean {
	return error instanceof TypeError;
}

async function metabaseFetch(
	path: string,
	settings: MetabaseSettings,
	init: RequestInit = {}
): Promise<Response> {
	if (!settings.baseUrl || !settings.adminApiKey)
		throw new Error('Metabase connection is not configured');
	return fetch(`${normalizeBaseUrl(settings.baseUrl)}${path}`, {
		...init,
		headers: {
			'X-API-Key': settings.adminApiKey,
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...init.headers
		}
	});
}

async function requestJson<T>(
	path: string,
	settings: MetabaseSettings,
	init: RequestInit = {}
): Promise<T> {
	let response: Response;
	try {
		response = await metabaseFetch(path, settings, init);
	} catch (error) {
		if (isLikelyCorsOrNetworkError(error)) {
			throw new Error('Metabase request blocked (CORS or network)', { cause: error });
		}
		throw error;
	}
	if (!response.ok) {
		let detail = `${response.status} ${response.statusText}`;
		try {
			const body: unknown = await response.json();
			if (body && typeof body === 'object' && 'message' in body) {
				detail = String((body as { message: unknown }).message);
			}
		} catch {
			// Preserve the HTTP status when Metabase returns a non-JSON error.
		}
		throw new Error(detail);
	}
	if (response.status === 204) return undefined as T;
	return (await response.json()) as T;
}

export function testConnection(settings: MetabaseSettings): Promise<unknown> {
	return requestJson('/api/session/properties', settings);
}

export function listGroups(settings: MetabaseSettings): Promise<MetabaseGroup[]> {
	return requestJson('/api/permissions/group', settings);
}

export function createGroup(settings: MetabaseSettings, name: string): Promise<MetabaseGroup> {
	return requestJson('/api/permissions/group', settings, {
		method: 'POST',
		body: JSON.stringify({ name })
	});
}

export async function ensureServiceGroup(settings: MetabaseSettings): Promise<MetabaseGroup> {
	const groups = await listGroups(settings);
	return (
		groups.find((group) => group.name === SERVICE_GROUP_NAME) ??
		(await createGroup(settings, SERVICE_GROUP_NAME))
	);
}

export function listApiKeys(settings: MetabaseSettings): Promise<MetabaseApiKey[]> {
	return requestJson('/api/api-key', settings);
}

export function createApiKey(
	settings: MetabaseSettings,
	name: string,
	groupId: number
): Promise<MetabaseApiKey & { unmasked_key: string }> {
	return requestJson('/api/api-key', settings, {
		method: 'POST',
		body: JSON.stringify({ name, group_id: groupId })
	});
}

export function revokeApiKey(settings: MetabaseSettings, id: number): Promise<void> {
	return requestJson<void>(`/api/api-key/${id}`, settings, { method: 'DELETE' });
}

export function listDatabases(settings: MetabaseSettings): Promise<MetabaseDatabase[]> {
	const response = requestJson<{ data?: MetabaseDatabase[] } | MetabaseDatabase[]>(
		'/api/database?include=tables',
		settings
	);
	return response.then((value) => (Array.isArray(value) ? value : (value.data ?? [])));
}

export function getPermissionGraph(settings: MetabaseSettings): Promise<PermissionGraph> {
	return requestJson('/api/permissions/graph', settings);
}

export function savePermissionGraph(
	settings: MetabaseSettings,
	graph: PermissionGraph
): Promise<PermissionGraph> {
	return requestJson('/api/permissions/graph', settings, {
		method: 'PUT',
		body: JSON.stringify(graph)
	});
}
