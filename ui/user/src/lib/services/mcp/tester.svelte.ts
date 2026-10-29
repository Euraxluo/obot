import { m } from '$lib/i18n';
import type { MCPCatalogServer } from '$lib/services/user/types';
import { LoggingTransport } from './logging-transport';
import { TesterClient, type RejectedTesterTool } from './tester-client';
import { testerErrorDetails } from './tester-errors';
import { MCPTesterLog } from './tester-log.svelte';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
	ErrorCode,
	ListPromptsResultSchema,
	ListResourcesResultSchema,
	McpError,
	type CallToolResult,
	type GetPromptResult,
	type Implementation,
	type Prompt,
	type ReadResourceResult,
	type Resource,
	type Tool
} from '@modelcontextprotocol/sdk/types.js';

export type TesterSection = 'tools' | 'prompts' | 'resources' | 'logs';
export type TesterCapabilitySection = Extract<TesterSection, 'tools' | 'prompts' | 'resources'>;
export type TesterStatus =
	| 'idle'
	| 'initializing'
	| 'ready'
	| 'access-denied'
	| 'unhealthy'
	| 'reauthentication-required'
	| 'setup-required'
	| 'error'
	| 'closed';

export function isUnavailableTesterFailure(status: TesterStatus): boolean {
	return status === 'error' || status === 'unhealthy';
}

export function testerStatusLabel(status: TesterStatus): string {
	switch (status) {
		case 'idle':
			return m.mcps_tester_log_status_idle();
		case 'initializing':
			return m.mcps_tester_log_status_initializing();
		case 'ready':
			return m.core_mcp_value_connected();
		default:
			return m.mcps_tester_status_unavailable();
	}
}

export type TesterWorkflowKind = 'direct';
export type DirectOperationStatus =
	| 'success'
	| 'mcp-error'
	| 'denied'
	| 'transport-error'
	| 'timeout'
	| 'cancelled';

export interface DirectOperationResult<T> {
	status: DirectOperationStatus;
	durationMs: number;
	value?: T;
	message?: string;
	details?: unknown;
}

export function normalizeTesterSection(value: string | null | undefined): TesterSection {
	switch (value) {
		case 'prompts':
		case 'resources':
		case 'logs':
			return value;
		default:
			return 'tools';
	}
}

export function testerConnectionKey(server?: MCPCatalogServer): string | undefined {
	if (!server) {
		return undefined;
	}

	return JSON.stringify([
		server.id,
		Boolean(server.configured),
		Boolean(server.missingOAuthCredentials),
		server.deploymentStatus ?? ''
	]);
}

export interface TesterWorkflow {
	id: symbol;
	kind: TesterWorkflowKind;
	label: string;
	abort: AbortController;
}

export interface CapabilityCache<T = unknown> {
	loaded: boolean;
	loading: boolean;
	unsupported: boolean;
	items: T[];
	pages: unknown[];
	error?: string;
	errorDetails?: unknown;
	errorStatus?: DirectOperationStatus;
}

export interface MCPPageCollection<T, TPage = unknown> {
	items: T[];
	pages: TPage[];
	rejectedTools?: RejectedTesterTool[];
}

type ToolsPage = Awaited<ReturnType<Client['listTools']>>;
type PromptsPage = Awaited<ReturnType<Client['listPrompts']>>;
type ResourcesPage = Awaited<ReturnType<Client['listResources']>>;

// Some servers advertise these capabilities but omit empty lists or serialize them as null.
// Keep validating list entries and pagination while accepting those empty representations.
const testerPromptsResultSchema = ListPromptsResultSchema.extend({
	prompts: ListPromptsResultSchema.shape.prompts.nullish().transform((prompts) => prompts ?? [])
});
const testerResourcesResultSchema = ListResourcesResultSchema.extend({
	resources: ListResourcesResultSchema.shape.resources
		.nullish()
		.transform((resources) => resources ?? [])
});

export interface TesterCapabilityCaches {
	tools: CapabilityCache<Tool>;
	prompts: CapabilityCache<Prompt>;
	resources: CapabilityCache<Resource>;
}

export interface TesterInspectorStates {
	tools: {
		selectedName?: string;
		argumentsValue?: Record<string, unknown>;
		result?: DirectOperationResult<CallToolResult>;
	};
	prompts: {
		selectedName?: string;
		argumentsValue: Record<string, string>;
		result?: DirectOperationResult<GetPromptResult>;
	};
	resources: {
		selectedURI?: string;
		result?: DirectOperationResult<ReadResourceResult>;
	};
}

function emptyInspectorStates(): TesterInspectorStates {
	return {
		tools: {},
		prompts: { argumentsValue: {} },
		resources: {}
	};
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function classifyOperationError(
	error: unknown,
	signal?: AbortSignal
): Pick<DirectOperationResult<never>, 'status' | 'message' | 'details'> {
	if (
		signal?.aborted ||
		(error instanceof DOMException && error.name === 'AbortError') ||
		(error instanceof Error && error.name === 'AbortError')
	) {
		return {
			status: 'cancelled',
			message: m.mcps_tester_op_cancelled_by_user(),
			details: testerErrorDetails(error)
		};
	}
	if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
		return {
			status: 'timeout',
			message: m.mcps_tester_op_timed_out(),
			details: testerErrorDetails(error)
		};
	}
	if (error instanceof StreamableHTTPError && error.code === 403) {
		return {
			status: 'denied',
			message: m.mcps_tester_op_denied(),
			details: testerErrorDetails(error)
		};
	}
	return {
		status: 'transport-error',
		message: errorMessage(error),
		details: testerErrorDetails(error)
	};
}

export function isTextualMimeType(mimeType?: string): boolean {
	if (!mimeType) return true;
	const normalized = mimeType.toLowerCase().split(';', 1)[0];
	return (
		normalized.startsWith('text/') ||
		normalized === 'application/json' ||
		normalized.endsWith('+json') ||
		normalized === 'application/xml' ||
		normalized.endsWith('+xml') ||
		normalized === 'application/javascript' ||
		normalized === 'application/typescript' ||
		normalized === 'application/yaml' ||
		normalized === 'application/x-yaml'
	);
}

class NoValidTesterToolsError extends Error {
	constructor(readonly rejectedTools: RejectedTesterTool[]) {
		super(m.mcps_tester_no_valid_tools(), { cause: rejectedTools });
	}
}

const maxPages = 500;

async function collectPages<T, TPage extends { nextCursor?: string }>(
	loadPage: (cursor?: string) => Promise<TPage>,
	selectItems: (page: TPage) => T[]
): Promise<MCPPageCollection<T, TPage>> {
	const items: T[] = [];
	const pages: TPage[] = [];
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local synchronous deduplication does not need reactive state
	const seen = new Set<string>();
	let cursor: string | undefined;

	do {
		const page = await loadPage(cursor);
		pages.push(page);
		items.push(...selectItems(page));
		cursor = page.nextCursor || undefined;
		if (cursor) {
			// The tester talks to arbitrary servers, so a cursor that repeats (or cycles) would
			// otherwise page forever and grow these arrays without bound.
			if (seen.has(cursor)) {
				throw new Error(m.mcps_tester_op_repeated_cursor({ cursor: JSON.stringify(cursor) }));
			}
			seen.add(cursor);
			if (seen.size > maxPages) {
				throw new Error(m.mcps_tester_op_too_many_pages({ count: maxPages }));
			}
		}
	} while (cursor);

	return { items, pages };
}

function requestMessage(init?: RequestInit): {
	method?: string;
	params?: Record<string, unknown>;
} {
	if (typeof init?.body !== 'string') return {};

	try {
		const body = JSON.parse(init.body) as
			| { method?: string; params?: Record<string, unknown> }
			| Array<{ method?: string; params?: Record<string, unknown> }>;
		return Array.isArray(body) ? (body.find((message) => message.method) ?? {}) : body;
	} catch {
		return {};
	}
}

function withAuditMetadata(fetcher: typeof fetch): typeof fetch {
	return async (input, init) => {
		const message = requestMessage(init);
		if (!message.method) return fetcher(input, init);

		// This URL is request-local transport metadata, not reactive UI state.
		const url = new URL(
			typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
			typeof window === 'undefined' ? 'http://localhost' : window.location.origin
		);
		url.searchParams.set('method', message.method);
		if (message.method === 'tools/call' && typeof message.params?.name === 'string') {
			url.searchParams.set('toolcallname', message.params.name);
		}
		return fetcher(url, init);
	};
}

function emptyCache<T>(): CapabilityCache<T> {
	return {
		loaded: false,
		loading: false,
		unsupported: false,
		items: [],
		pages: []
	};
}

export class MCPTesterSession {
	client: TesterClient;
	readonly server: MCPCatalogServer;
	readonly #clientInfo: Implementation;
	readonly #fetcher: typeof fetch;
	transport: LoggingTransport;
	readonly log = new MCPTesterLog();
	#connectionAttempted = false;
	status = $state<TesterStatus>('idle');
	error = $state<string>();
	errorDetails = $state<unknown>();
	toolDiscoveryIssues = $state<RejectedTesterTool[]>([]);
	activeWorkflow = $state<TesterWorkflow>();
	cache = $state<TesterCapabilityCaches>({
		tools: emptyCache(),
		prompts: emptyCache(),
		resources: emptyCache()
	});
	inspectors = $state<TesterInspectorStates>(emptyInspectorStates());

	constructor(server: MCPCatalogServer, clientInfo: Implementation, fetcher: typeof fetch = fetch) {
		this.server = server;
		this.#clientInfo = clientInfo;
		this.#fetcher = fetcher;
		({ client: this.client, transport: this.transport } = this.#createConnection());
	}

	#createConnection(): { client: TesterClient; transport: LoggingTransport } {
		const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
		const client = new TesterClient(this.#clientInfo, { capabilities: {} });
		// The endpoint is immutable connection configuration, not reactive UI state.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const endpoint = new URL(`/mcp-connect/${encodeURIComponent(this.server.id)}`, origin);
		const transport = new StreamableHTTPClientTransport(endpoint, {
			fetch: withAuditMetadata(this.#fetcher),
			requestInit: { credentials: 'same-origin' }
		});
		return { client, transport: new LoggingTransport(transport, this.log) };
	}

	async #resetConnection(): Promise<void> {
		this.transport.detach();
		await this.client.close();
		this.log.clear();
		({ client: this.client, transport: this.transport } = this.#createConnection());
	}

	async initialize(force = false): Promise<void> {
		if (this.status === 'closed' || this.status === 'initializing') return;
		if (!this.server.configured) {
			this.status = this.server.missingOAuthCredentials
				? 'reauthentication-required'
				: 'setup-required';
			return;
		}
		if (
			!force &&
			['Unavailable', 'Needs Attention', 'Shutdown', 'Unknown'].includes(
				this.server.deploymentStatus ?? ''
			)
		) {
			this.status = 'unhealthy';
			return;
		}

		this.status = 'initializing';
		this.error = undefined;
		this.errorDetails = undefined;
		try {
			if (this.#connectionAttempted) {
				await this.#resetConnection();
			}
			this.#connectionAttempted = true;
			await this.client.connect(this.transport);
			if (!this.isClosed()) {
				this.status = 'ready';
			}
		} catch (error) {
			if (this.isClosed()) return;
			this.error = error instanceof Error ? error.message : String(error);
			this.errorDetails = testerErrorDetails(error);
			if (error instanceof StreamableHTTPError) {
				switch (error.code) {
					case 401:
						this.status = 'reauthentication-required';
						return;
					case 403:
						this.status = 'access-denied';
						return;
					case 412:
					case 424:
					case 503:
						this.status = 'unhealthy';
						return;
				}
			}
			this.status = 'error';
		}
	}

	async listTools(
		signal?: AbortSignal
	): Promise<MCPPageCollection<ToolsPage['tools'][number], ToolsPage>> {
		const client = this.client;
		client.rejectedTools = [];
		const result = await collectPages(
			(cursor) => client.listTools(cursor ? { cursor } : {}, { signal }),
			(page) => page.tools
		);
		const rejectedTools = [...client.rejectedTools];
		if (!result.items.length && rejectedTools.length) {
			throw new NoValidTesterToolsError(rejectedTools);
		}
		return { ...result, rejectedTools };
	}

	listPrompts(
		signal?: AbortSignal
	): Promise<MCPPageCollection<PromptsPage['prompts'][number], PromptsPage>> {
		return collectPages(
			(cursor) =>
				this.client.request(
					{ method: 'prompts/list', params: cursor ? { cursor } : {} },
					testerPromptsResultSchema,
					{ signal }
				),
			(page) => page.prompts
		);
	}

	listResources(
		signal?: AbortSignal
	): Promise<MCPPageCollection<ResourcesPage['resources'][number], ResourcesPage>> {
		return collectPages(
			(cursor) =>
				this.client.request(
					{ method: 'resources/list', params: cursor ? { cursor } : {} },
					testerResourcesResultSchema,
					{ signal }
				),
			(page) => page.resources
		);
	}

	isCapabilitySupported(section: TesterCapabilitySection): boolean {
		return Boolean(this.client.getServerCapabilities()?.[section]);
	}

	async loadTools(force = false): Promise<void> {
		await this.#loadCapability('tools', force, (signal) => this.listTools(signal));
	}

	async loadPrompts(force = false): Promise<void> {
		await this.#loadCapability('prompts', force, (signal) => this.listPrompts(signal));
	}

	async loadResources(force = false): Promise<void> {
		await this.#loadCapability('resources', force, (signal) => this.listResources(signal));
	}

	async #loadCapability<K extends keyof TesterCapabilityCaches>(
		section: K,
		force: boolean,
		load: (
			signal: AbortSignal
		) => Promise<MCPPageCollection<TesterCapabilityCaches[K]['items'][number]>>
	): Promise<void> {
		const cache = this.cache[section];
		if (cache.loading || (!force && cache.loaded)) return;
		if (this.activeWorkflow) return;
		if (!this.isCapabilitySupported(section)) {
			if (section === 'tools') this.toolDiscoveryIssues = [];
			cache.loaded = true;
			cache.unsupported = true;
			cache.items = [];
			cache.pages = [];
			cache.error = undefined;
			cache.errorDetails = undefined;
			cache.errorStatus = undefined;
			return;
		}

		const workflow = this.beginWorkflow('direct', `${section} discovery`);
		cache.loading = true;
		cache.unsupported = false;
		cache.error = undefined;
		cache.errorDetails = undefined;
		cache.errorStatus = undefined;
		try {
			const result = await load(workflow.abort.signal);
			if (workflow.abort.signal.aborted) return;
			cache.items = result.items;
			cache.pages = result.pages;
			if (section === 'tools') this.toolDiscoveryIssues = result.rejectedTools ?? [];
			cache.loaded = true;
		} catch (error) {
			if (
				section !== 'tools' &&
				!workflow.abort.signal.aborted &&
				error instanceof McpError &&
				error.code === ErrorCode.MethodNotFound
			) {
				cache.loaded = true;
				cache.unsupported = true;
				cache.items = [];
				cache.pages = [];
				return;
			}
			if (error instanceof NoValidTesterToolsError && !workflow.abort.signal.aborted) {
				this.toolDiscoveryIssues = error.rejectedTools;
				cache.items = [];
				cache.pages = [];
				cache.loaded = false;
				this.inspectors.tools = {};
			}
			const classified = classifyOperationError(error, workflow.abort.signal);
			cache.error = classified.message;
			cache.errorDetails = classified.details;
			cache.errorStatus = classified.status;
			if (classified.status === 'denied') this.status = 'access-denied';
		} finally {
			cache.loading = false;
			this.finishWorkflow(workflow);
		}
	}

	async executeDirect<T>(
		label: string,
		operation: (signal: AbortSignal) => Promise<T>
	): Promise<DirectOperationResult<T>> {
		const workflow = this.beginWorkflow('direct', label);
		const started = performance.now();
		try {
			const value = await operation(workflow.abort.signal);
			const status =
				typeof value === 'object' && value !== null && 'isError' in value && value.isError === true
					? 'mcp-error'
					: 'success';
			return { status, durationMs: performance.now() - started, value };
		} catch (error) {
			const classified = classifyOperationError(error, workflow.abort.signal);
			if (classified.status === 'denied') this.status = 'access-denied';
			return { ...classified, durationMs: performance.now() - started };
		} finally {
			this.finishWorkflow(workflow);
		}
	}

	callTool(
		name: string,
		args: Record<string, unknown>
	): Promise<DirectOperationResult<CallToolResult>> {
		return this.executeDirect('tool call', async (signal) => {
			return (await this.client.callTool({ name, arguments: args }, undefined, {
				signal
			})) as CallToolResult;
		});
	}

	getPrompt(
		name: string,
		args: Record<string, string>
	): Promise<DirectOperationResult<GetPromptResult>> {
		return this.executeDirect('prompt get', (signal) =>
			this.client.getPrompt({ name, arguments: args }, { signal })
		);
	}

	readResource(uri: string): Promise<DirectOperationResult<ReadResourceResult>> {
		return this.executeDirect('resource read', (signal) =>
			this.client.readResource({ uri }, { signal })
		);
	}

	private isClosed(): boolean {
		return this.status === 'closed';
	}

	beginWorkflow(kind: TesterWorkflowKind, label: string): TesterWorkflow {
		if (this.status !== 'ready') {
			throw new Error(m.mcps_tester_not_ready());
		}
		if (this.activeWorkflow) {
			throw new Error(m.mcps_tester_workflow_busy({ label, active: this.activeWorkflow.label }));
		}
		const workflow: TesterWorkflow = {
			id: Symbol(label),
			kind,
			label,
			abort: new AbortController()
		};
		this.activeWorkflow = workflow;
		return workflow;
	}

	finishWorkflow(workflow: TesterWorkflow): void {
		if (this.activeWorkflow?.id === workflow.id) {
			this.activeWorkflow = undefined;
		}
	}

	cancelActiveWorkflow(): void {
		this.activeWorkflow?.abort.abort('Cancelled by user');
	}

	close(): void {
		if (this.status === 'closed') return;
		this.cancelActiveWorkflow();
		this.activeWorkflow = undefined;
		void this.client.close();
		this.cache = {
			tools: emptyCache(),
			prompts: emptyCache(),
			resources: emptyCache()
		};
		this.inspectors = emptyInspectorStates();
		this.error = undefined;
		this.status = 'closed';
	}
}
