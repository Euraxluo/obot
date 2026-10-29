import { overwriteGetLocale } from '$lib/paraglide/runtime';
import type { MCPCatalogServer } from '$lib/services';
import { MCPTesterSession, normalizeTesterSection, testerConnectionKey } from './tester.svelte';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';

overwriteGetLocale(() => 'en');
const server = {
	id: 'ms1tester',
	configured: true,
	deploymentStatus: 'Available',
	manifest: {
		name: 'Tester Server',
		runtime: 'remote',
		serverUserType: 'singleUser'
	}
} as unknown as MCPCatalogServer;

interface MCPRequest {
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
}

function readyFetch(
	capabilities: Record<string, unknown> = {},
	handleRequest?: (request: MCPRequest) => Response | undefined
) {
	return vi.fn<typeof fetch>(async (_input, init) => {
		if (init?.method === 'GET') {
			return new Response(null, { status: 405 });
		}

		const request = JSON.parse(String(init?.body)) as MCPRequest;
		const handled = handleRequest?.(request);
		if (handled) return handled;
		if (request.method === 'initialize') {
			return Response.json(
				{
					jsonrpc: '2.0',
					id: request.id,
					result: {
						protocolVersion: request.params?.protocolVersion,
						capabilities,
						serverInfo: { name: 'tester-server', version: '1.0.0' }
					}
				},
				{ headers: { 'Mcp-Session-Id': 'tester-session' } }
			);
		}
		if (request.method === 'notifications/initialized') {
			return new Response(null, { status: 202 });
		}
		return new Response('unexpected MCP request', { status: 500 });
	});
}

describe('partial tool discovery', () => {
	it('preserves the cached list and its diagnostics when a refresh is cancelled', async () => {
		const fetcher = readyFetch({ tools: {} }, (request) => {
			if (request.method !== 'tools/list') return;
			return Response.json({
				jsonrpc: '2.0',
				id: request.id,
				result: {
					tools: [
						{ name: 'retained', inputSchema: { type: 'object' } },
						{ name: 'rejected', inputSchema: { type: 'array' } }
					]
				}
			});
		});
		const session = new MCPTesterSession(server, { name: 'tester', version: 'test' }, fetcher);
		await session.initialize();
		await session.loadTools();
		const diagnostics = [...session.toolDiscoveryIssues];
		const original = fetcher.getMockImplementation()!;
		let pending = false;
		fetcher.mockImplementation(async (input, init) => {
			if (typeof init?.body === 'string' && JSON.parse(init.body).method === 'tools/list') {
				pending = true;
				return new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
			return original(input, init);
		});
		const refresh = session.loadTools(true);
		await vi.waitFor(() => expect(pending).toBe(true));
		session.cancelActiveWorkflow();
		await refresh;
		expect(session.cache.tools.items.map((tool) => tool.name)).toEqual(['retained']);
		expect(session.toolDiscoveryIssues).toEqual(diagnostics);
		session.close();
	});

	it('retains valid tools across pages and the original malformed entries in the MCP log', async () => {
		const fetcher = readyFetch({ tools: {} }, (request) => {
			if (request.method !== 'tools/list') return;
			return Response.json({
				jsonrpc: '2.0',
				id: request.id,
				result: request.params?.cursor
					? { tools: [null, { name: 'second', inputSchema: { type: 'object' } }] }
					: {
							tools: [
								{ name: 'first', inputSchema: { type: 'object' } },
								{
									name: 'add_issue_comment',
									inputSchema: { type: 'object' },
									outputSchema: { oneOf: [{ type: 'null' }, { type: 'object' }] }
								}
							],
							nextCursor: 'next-page'
						}
			});
		});
		const session = new MCPTesterSession(server, { name: 'tester', version: 'test' }, fetcher);
		await session.initialize();
		await session.loadTools();

		expect(session.cache.tools.error).toBeUndefined();
		expect(session.cache.tools.items.map((tool) => tool.name)).toEqual(['first', 'second']);
		expect(session.toolDiscoveryIssues).toMatchObject([
			{ name: 'add_issue_comment', index: 1, issues: [{ path: ['outputSchema', 'type'] }] },
			{ index: 0, cursor: 'next-page' }
		]);
		expect(
			session.log.entries.some(
				(entry) =>
					entry.direction === 'incoming' && JSON.stringify(entry.message).includes('"oneOf"')
			)
		).toBe(true);
		session.close();
	});

	it('replaces diagnostics on refresh and clears stale tools when every entry becomes invalid', async () => {
		let malformed = false;
		const session = new MCPTesterSession(
			server,
			{ name: 'tester', version: 'test' },
			readyFetch({ tools: {} }, (request) => {
				if (request.method !== 'tools/list') return;
				return Response.json({
					jsonrpc: '2.0',
					id: request.id,
					result: {
						tools: [{ name: 'lookup', inputSchema: { type: malformed ? 'array' : 'object' } }]
					}
				});
			})
		);
		await session.initialize();
		await session.loadTools();
		expect(session.cache.tools.items).toHaveLength(1);
		malformed = true;
		await session.loadTools(true);
		expect(session.cache.tools.items).toEqual([]);
		expect(session.cache.tools.loaded).toBe(false);
		expect(session.cache.tools.error).toContain('every returned tool');
		expect(session.toolDiscoveryIssues).toHaveLength(1);
		expect(session.cache.tools.errorDetails).toMatchObject({ cause: [{ name: 'lookup' }] });
		malformed = false;
		await session.loadTools(true);
		expect(session.toolDiscoveryIssues).toEqual([]);
		expect(session.cache.tools.errorDetails).toBeUndefined();
		expect(session.cache.tools.error).toBeUndefined();
		session.close();
	});

	it.each([
		{ tools: [], succeeds: true },
		{ tools: null, succeeds: false },
		{ tools: { name: 'not-an-array' }, succeeds: false }
	])(
		'keeps empty lists valid and rejects malformed list envelopes: $tools',
		async ({ tools, succeeds }) => {
			const session = new MCPTesterSession(
				server,
				{ name: 'tester', version: 'test' },
				readyFetch({ tools: {} }, (request) => {
					if (request.method !== 'tools/list') return;
					return Response.json({ jsonrpc: '2.0', id: request.id, result: { tools } });
				})
			);
			await session.initialize();
			await session.loadTools();
			expect(session.cache.tools.loaded).toBe(succeeds);
			expect(Boolean(session.cache.tools.error)).toBe(!succeeds);
			expect(session.toolDiscoveryIssues).toEqual([]);
			session.close();
		}
	);

	it('keeps SDK output validation and task metadata for retained tools', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'tester', version: 'test' },
			readyFetch({ tools: {}, tasks: { requests: { tools: { call: {} } } } }, (request) => {
				if (request.method === 'tools/list')
					return Response.json({
						jsonrpc: '2.0',
						id: request.id,
						result: {
							tools: [
								{ name: 'bad', inputSchema: { type: 'object' }, outputSchema: { type: 'array' } },
								{
									name: 'lookup',
									inputSchema: { type: 'object' },
									outputSchema: {
										type: 'object',
										properties: { value: { type: 'string' } },
										required: ['value']
									}
								},
								{
									name: 'task',
									inputSchema: { type: 'object' },
									execution: { taskSupport: 'required' }
								}
							]
						}
					});
				if (request.method === 'tools/call')
					return Response.json({
						jsonrpc: '2.0',
						id: request.id,
						result: { content: [], structuredContent: { value: 42 } }
					});
			})
		);
		await session.initialize();
		await session.loadTools();
		const result = await session.callTool('lookup', {});
		expect(result.status).toBe('transport-error');
		expect(result.message).toContain('output schema');
		expect(result.details).toMatchObject({ code: -32602 });
		const task = await session.callTool('task', {});
		expect(task.message).toContain('requires task-based execution');
		session.close();
	});
});

describe('testerConnectionKey', () => {
	it('keeps the same connection key when only unrelated server fields change', () => {
		expect(testerConnectionKey(undefined)).toBeUndefined();
		expect(
			testerConnectionKey({
				...server,
				created: '2026-09-14T00:00:00Z',
				updated: '2026-09-14T00:00:00Z',
				manifest: { ...server.manifest, name: 'Renamed Tester Server' }
			} as MCPCatalogServer)
		).toBe(testerConnectionKey(server));
	});

	it('changes the connection key when session identity fields change', () => {
		expect(testerConnectionKey({ ...server, id: 'ms2tester' } as MCPCatalogServer)).not.toBe(
			testerConnectionKey(server)
		);
		expect(testerConnectionKey({ ...server, configured: false } as MCPCatalogServer)).not.toBe(
			testerConnectionKey(server)
		);
		expect(
			testerConnectionKey({ ...server, missingOAuthCredentials: true } as MCPCatalogServer)
		).not.toBe(testerConnectionKey(server));
		expect(
			testerConnectionKey({ ...server, deploymentStatus: 'Unavailable' } as MCPCatalogServer)
		).not.toBe(testerConnectionKey(server));
	});
});

describe('MCPTesterSession', () => {
	it('defaults missing and invalid tab values to tools', () => {
		expect(normalizeTesterSection(undefined)).toBe('tools');
		expect(normalizeTesterSection('invalid')).toBe('tools');
		expect(normalizeTesterSection('chat')).toBe('tools');
		expect(normalizeTesterSection('logs')).toBe('logs');
		expect(normalizeTesterSection('resources')).toBe('resources');
	});

	it('uses the official SDK with tester identity, no capabilities, and memory-only state', async () => {
		const fetcher = readyFetch();
		const localGet = vi.spyOn(Storage.prototype, 'getItem');
		const localSet = vi.spyOn(Storage.prototype, 'setItem');
		const localRemove = vi.spyOn(Storage.prototype, 'removeItem');
		const sessionGet = vi.spyOn(sessionStorage, 'getItem');
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: '1.2.3' },
			fetcher
		);

		expect(session.client).toBeInstanceOf(Client);
		await session.initialize();

		const initializeCall = fetcher.mock.calls.find(([, init]) => {
			if (typeof init?.body !== 'string') return false;
			return (JSON.parse(init.body) as MCPRequest).method === 'initialize';
		});
		expect(initializeCall).toBeDefined();
		const initialize = JSON.parse(String(initializeCall?.[1]?.body)) as MCPRequest;
		expect(initialize.params?.clientInfo).toEqual({
			name: 'obot-mcp-tester',
			version: '1.2.3'
		});
		expect(initialize.params?.capabilities).toEqual({});
		expect(new URL(String(initializeCall?.[0])).searchParams.get('method')).toBe('initialize');
		expect(initializeCall?.[1]?.credentials).toBe('same-origin');
		expect(localGet).not.toHaveBeenCalled();
		expect(localSet).not.toHaveBeenCalled();
		expect(localRemove).not.toHaveBeenCalled();
		expect(sessionGet).not.toHaveBeenCalled();

		const signal = initializeCall?.[1]?.signal;
		session.close();
		expect(signal?.aborted).toBe(true);
		expect(localRemove).not.toHaveBeenCalled();
	});

	it('uses typed SDK list calls to follow cursors and retain raw pages', async () => {
		let page = 0;
		const fetcher = readyFetch({ tools: {} }, (request) => {
			if (request.method !== 'tools/list') return;
			page += 1;
			return Response.json({
				jsonrpc: '2.0',
				id: request.id,
				result:
					page === 1
						? {
								tools: [{ name: 'first', inputSchema: { type: 'object' } }],
								nextCursor: 'next-page'
							}
						: { tools: [{ name: 'second', inputSchema: { type: 'object' } }] }
			});
		});
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			fetcher
		);
		await session.initialize();

		const result = await session.listTools();

		expect(result.items.map((tool) => tool.name)).toEqual(['first', 'second']);
		expect(result.pages).toHaveLength(2);
		const listRequests = fetcher.mock.calls
			.filter(([, init]) => {
				if (typeof init?.body !== 'string') return false;
				return (JSON.parse(init.body) as MCPRequest).method === 'tools/list';
			})
			.map(([, init]) => (JSON.parse(String(init?.body)) as MCPRequest).params);
		expect(listRequests).toEqual([{}, { cursor: 'next-page' }]);
		session.close();
	});

	it('stops paging when a server repeats a cursor instead of looping forever', async () => {
		const fetcher = readyFetch({ tools: {} }, (request) => {
			if (request.method !== 'tools/list') return;
			return Response.json({
				jsonrpc: '2.0',
				id: request.id,
				result: {
					tools: [{ name: 'looping', inputSchema: { type: 'object' } }],
					nextCursor: 'same-page'
				}
			});
		});
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			fetcher
		);
		await session.initialize();

		await expect(session.listTools()).rejects.toThrow(/repeated pagination cursor/);

		const listRequests = fetcher.mock.calls.filter(([, init]) => {
			if (typeof init?.body !== 'string') return false;
			return (JSON.parse(init.body) as MCPRequest).method === 'tools/list';
		});
		expect(listRequests).toHaveLength(2);
		session.close();
	});

	it('loads advertised capabilities lazily, caches them, and refreshes on request', async () => {
		let listCalls = 0;
		const fetcher = readyFetch({ prompts: {} }, (request) => {
			if (request.method !== 'prompts/list') return;
			listCalls += 1;
			return Response.json({
				jsonrpc: '2.0',
				id: request.id,
				result: { prompts: [{ name: `prompt-${listCalls}` }] }
			});
		});
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			fetcher
		);
		await session.initialize();

		expect(listCalls).toBe(0);
		await session.loadPrompts();
		await session.loadPrompts();
		expect(listCalls).toBe(1);
		expect(session.cache.prompts.items[0]?.name).toBe('prompt-1');

		await session.loadPrompts(true);
		expect(listCalls).toBe(2);
		expect(session.cache.prompts.items[0]?.name).toBe('prompt-2');
		session.close();
	});

	it('marks unadvertised capabilities unsupported without issuing a list request', async () => {
		const fetcher = readyFetch();
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			fetcher
		);
		await session.initialize();
		await session.loadResources();

		expect(session.cache.resources.unsupported).toBe(true);
		expect(
			fetcher.mock.calls.some(([, init]) => String(init?.body).includes('resources/list'))
		).toBe(false);
		session.close();
	});

	it('holds the workflow token until a cancelled operation settles', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			readyFetch()
		);
		await session.initialize();

		let rejectOperation: ((reason: unknown) => void) | undefined;
		const pending = session.executeDirect(
			'slow call',
			() =>
				new Promise((_resolve, reject) => {
					rejectOperation = reject;
				})
		);
		expect(session.activeWorkflow).toBeDefined();

		session.cancelActiveWorkflow();
		expect(session.activeWorkflow).toBeDefined();
		expect(() => session.beginWorkflow('direct', 'second call')).toThrow(
			/while slow call is active/
		);

		rejectOperation?.(new DOMException('Aborted', 'AbortError'));
		await pending;
		expect(session.activeWorkflow).toBeUndefined();
		session.close();
	});

	it('creates a fresh SDK connection when initialization is retried', async () => {
		let initializeAttempts = 0;
		const fetcher = readyFetch({}, (request) => {
			if (request.method === 'initialize' && initializeAttempts++ === 0) {
				return new Response('server unavailable', { status: 503 });
			}
		});
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			fetcher
		);

		await session.initialize();
		expect(session.status).toBe('unhealthy');

		await session.initialize(true);
		expect(session.status).toBe('ready');
		expect(initializeAttempts).toBe(2);
		session.close();
	});

	it('coordinates one workflow and cancels it during teardown', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			readyFetch()
		);
		await session.initialize();
		expect(session.status).toBe('ready');

		const workflow = session.beginWorkflow('direct', 'tool call');
		expect(() => session.beginWorkflow('direct', 'second operation')).toThrow(
			/tool call is active/
		);
		session.close();

		expect(workflow.abort.signal.aborted).toBe(true);
		expect(session.status).toBe('closed');
		expect(session.activeWorkflow).toBeUndefined();
		expect(session.cache.tools.items).toEqual([]);
	});

	it('classifies setup, health, authentication, and access states', async () => {
		const setup = new MCPTesterSession(
			{ ...server, configured: false },
			{ name: 'obot-mcp-tester', version: 'test' },
			vi.fn<typeof fetch>()
		);
		await setup.initialize();
		expect(setup.status).toBe('setup-required');

		const reauthenticate = new MCPTesterSession(
			{ ...server, configured: false, missingOAuthCredentials: true },
			{ name: 'obot-mcp-tester', version: 'test' },
			vi.fn<typeof fetch>()
		);
		await reauthenticate.initialize();
		expect(reauthenticate.status).toBe('reauthentication-required');

		const unhealthy = new MCPTesterSession(
			{ ...server, deploymentStatus: 'Unavailable' },
			{ name: 'obot-mcp-tester', version: 'test' },
			vi.fn<typeof fetch>()
		);
		await unhealthy.initialize();
		expect(unhealthy.status).toBe('unhealthy');

		const denied = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			vi.fn<typeof fetch>().mockResolvedValue(new Response('forbidden', { status: 403 }))
		);
		await denied.initialize();
		expect(denied.status).toBe('access-denied');

		const expiredAuthentication = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			vi.fn<typeof fetch>().mockResolvedValue(new Response('unauthorized', { status: 401 }))
		);
		await expiredAuthentication.initialize();
		expect(expiredAuthentication.status).toBe('reauthentication-required');
	});
	it('records the initialize handshake in both directions', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			readyFetch()
		);
		await session.initialize();

		const methods = session.log.entries.map((entry) => `${entry.direction} ${entry.method}`);
		expect(methods).toContain('outgoing initialize');
		expect(methods).toContain('outgoing notifications/initialized');

		const initializeRequest = session.log.entries.find(
			(entry) => entry.kind === 'request' && entry.method === 'initialize'
		);
		expect(initializeRequest?.outcome).toBe('ok');
		expect(initializeRequest?.durationMs).toBeGreaterThanOrEqual(0);

		const initializeResponse = session.log.entries.find(
			(entry) => entry.id === initializeRequest?.responseEntryId
		);
		expect(initializeResponse?.direction).toBe('incoming');
		expect(initializeResponse?.kind).toBe('response');

		session.close();
	});

	it('logs a tool call issued through the session', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			readyFetch({ tools: {} }, (request) =>
				request.method === 'tools/call'
					? Response.json({
							jsonrpc: '2.0',
							id: request.id,
							result: { content: [{ type: 'text', text: 'ok' }] }
						})
					: undefined
			)
		);
		await session.initialize();
		await session.callTool('lookup', { query: 'a' });

		const call = session.log.entries.find(
			(entry) => entry.kind === 'request' && entry.method === 'tools/call'
		);
		expect(call?.direction).toBe('outgoing');
		expect(call?.outcome).toBe('ok');

		session.close();
	});

	it('clears the log when the connection is rebuilt', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			readyFetch()
		);
		await session.initialize();
		const before = session.log.entries.map((entry) => entry.id);
		expect(before.length).toBeGreaterThan(0);

		await session.initialize(true);

		// Nothing from the previous connection survives, but the new handshake is present
		// and its ids never collide with the cleared ones.
		const after = session.log.entries;
		expect(after.some((entry) => before.includes(entry.id))).toBe(false);
		expect(after.some((entry) => entry.method === 'initialize')).toBe(true);

		session.close();
	});

	it('records a transport error when the connection fails', async () => {
		const session = new MCPTesterSession(
			server,
			{ name: 'obot-mcp-tester', version: 'test' },
			vi.fn<typeof fetch>().mockResolvedValue(new Response('boom', { status: 500 }))
		);
		await session.initialize();

		expect(session.status).toBe('error');
		expect(session.log.entries.some((entry) => entry.event === 'error')).toBe(true);
		// The outgoing frame is recorded before the transport throws.
		expect(session.log.entries.some((entry) => entry.method === 'initialize')).toBe(true);

		session.close();
	});
});
