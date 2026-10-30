import { page as appPage } from '$app/state';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import {
	createMcpConnectPostResolver,
	type MCPRequest
} from '../../../../tests/helpers/mcpConnect';
import { preparePageData } from '../../../../tests/helpers/pageData';
import { createMcpServerDetailsFixtures } from '../../../../tests/mocks/data';
import { worker } from '../../../../tests/mocks/worker';
import type { PageData } from './$types';
import TesterPage from './+page.svelte';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');
const fixtures = createMcpServerDetailsFixtures();

function mockMCPInitialization(
	capabilities: Record<string, unknown> = {},
	handleRequest?: (request: MCPRequest) => unknown
) {
	worker.use(
		http.post('/mcp-connect/:connectId', createMcpConnectPostResolver(capabilities, handleRequest)),
		http.get('/mcp-connect/:connectId', () => new HttpResponse(null, { status: 405 }))
	);
}

function mockMCPInitializationFailure(status = 500) {
	worker.use(
		http.post('/mcp-connect/:connectId', () => new HttpResponse(null, { status })),
		http.get('/mcp-connect/:connectId', () => new HttpResponse(null, { status: 405 }))
	);
}

async function renderTester(
	tab?: string,
	capabilities: Record<string, unknown> = {},
	handleRequest?: (request: MCPRequest) => unknown,
	pageOverrides: Partial<PageData> = {}
) {
	mockMCPInitialization(capabilities, handleRequest);
	if (tab) {
		appPage.url.searchParams.set('tab', tab);
	} else {
		appPage.url.searchParams.delete('tab');
	}

	const data = await preparePageData<PageData>({
		server: {
			...fixtures.serverSingle,
			configured: true,
			deploymentStatus: 'Available',
			canConnect: true
		},
		backTarget: `/mcp-servers/c/${fixtures.entrySingle.id}/instance/${fixtures.serverSingle.id}`,
		...pageOverrides
	});
	return render(TesterPage, { data });
}

function testerSection(name: string | RegExp) {
	return page
		.getByRole('navigation', { name: 'MCP tester sections' })
		.getByRole('button', { name });
}

describe('MCP Tester page', () => {
	it('initializes the shell and defaults an invalid tab to Tools', async () => {
		await renderTester('not-a-tab');

		const serverName = fixtures.serverSingle.manifest.name;
		const headings = page.getByRole('heading', { name: serverName, level: 1 });
		await expect.element(headings.first()).toBeVisible();
		await expect.element(headings.nth(1)).toBeVisible();
		expect(document.title).toBe(`ZTOCC | MCP Tester | ${serverName}`);
		await expect.element(testerSection('Tools')).toHaveClass(/page-tab-active/);
		await expect.element(testerSection('Chat')).not.toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: `Back to ${serverName}` }))
			.toHaveAttribute(
				'href',
				`/mcp-servers/c/${fixtures.entrySingle.id}/instance/${fixtures.serverSingle.id}`
			);
	});

	it('keeps server management available for non-vMCP authentication', async () => {
		mockMCPInitializationFailure(401);
		appPage.url.searchParams.delete('tab');
		const backTarget = `/mcp-servers/s/${fixtures.serverSingle.id}`;
		const data = await preparePageData<PageData>({
			server: { ...fixtures.serverSingle, configured: true, deploymentStatus: 'Available' },
			backTarget
		});
		await render(TesterPage, { data });

		await expect
			.element(page.getByRole('link', { name: 'Manage authentication' }))
			.toHaveAttribute('href', backTarget);
	});

	it('connects a vMCP instance through its requested connect ID', async () => {
		await renderTester('tools', {}, undefined, {
			server: {
				...fixtures.serverSingle,
				id: 'vmcpi1-test',
				catalogEntryID: '',
				mcpCatalogID: '',
				manifest: { name: 'Virtual test server', runtime: 'vmcp' }
			},
			backTarget: '/vmcps'
		});

		await expect
			.element(page.getByRole('heading', { name: 'Virtual test server', level: 1 }).first())
			.toBeVisible();
		expect(document.title).toBe('ZTOCC | vMCP Tester | Virtual test server');
		await expect.element(page.getByRole('heading', { name: 'Tools', exact: true })).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Back to Virtual test server' }))
			.toHaveAttribute('href', '/vmcps');
	});

	it('discovers, searches, validates, and directly calls tools', async () => {
		await renderTester('tools', { tools: {} }, (request) => {
			if (request.method === 'tools/list') {
				return {
					tools: [
						{
							name: 'lookup',
							description: 'Look up a record',
							inputSchema: {
								type: 'object',
								required: ['query'],
								properties: {
									query: { type: 'string', minLength: 2 },
									limit: { type: 'integer', minimum: 1 }
								}
							},
							outputSchema: {
								type: 'object',
								properties: { found: { type: 'boolean' } }
							}
						}
					]
				};
			}
			if (request.method === 'tools/call') {
				return {
					content: [{ type: 'text', text: 'Found safely <script>never runs</script>' }],
					structuredContent: { found: true },
					isError: false
				};
			}
		});

		await page.getByRole('button', { name: /lookup/ }).click();
		await page.getByLabelText('query *').fill('record');
		await page.getByLabelText('limit').fill('2');
		await page.getByRole('button', { name: 'Call', exact: true }).click();

		await expect.element(page.getByText('Succeeded')).toBeVisible();
		await expect
			.element(page.getByText('Found safely <script>never runs</script>', { exact: true }).first())
			.toBeVisible();
		await expect.element(page.getByText('Structured content')).toBeVisible();
	});

	it('drops a tool result once its arguments no longer match', async () => {
		await renderTester('tools', { tools: {} }, (request) => {
			if (request.method === 'tools/list') {
				return {
					tools: [
						{
							name: 'lookup',
							inputSchema: {
								type: 'object',
								required: ['query'],
								properties: { query: { type: 'string', minLength: 2 } }
							}
						}
					]
				};
			}
			if (request.method === 'tools/call') {
				return { content: [{ type: 'text', text: 'Result for record' }], isError: false };
			}
		});

		await page.getByRole('button', { name: /lookup/ }).click();
		await page.getByLabelText('query *').fill('record');
		await page.getByRole('button', { name: 'Call', exact: true }).click();
		await expect
			.element(page.getByText('Result for record', { exact: true }).first())
			.toBeVisible();

		await page.getByLabelText('query *').fill('other record');
		await expect
			.element(page.getByText('Result for record', { exact: true }))
			.not.toBeInTheDocument();
	});

	it('resolves prompt arguments and preserves message roles and order', async () => {
		await renderTester('prompts', { prompts: {} }, (request) => {
			if (request.method === 'prompts/list') {
				return {
					prompts: [
						{
							name: 'explain',
							description: 'Explain a topic',
							arguments: [{ name: 'topic', required: true }]
						}
					]
				};
			}
			if (request.method === 'prompts/get') {
				return {
					messages: [
						{ role: 'user', content: { type: 'text', text: 'First message' } },
						{ role: 'assistant', content: { type: 'text', text: 'Second message' } }
					]
				};
			}
		});

		await page.getByRole('button', { name: /explain/ }).click();
		await page.getByLabelText('topic *').fill('MCP');
		await page.getByRole('button', { name: 'Get prompt' }).click();

		await expect.element(page.getByText('First message', { exact: true }).first()).toBeVisible();
		await expect.element(page.getByText('Second message', { exact: true }).first()).toBeVisible();
		await expect.element(page.getByText('user', { exact: true })).toBeVisible();
		await expect.element(page.getByText('assistant', { exact: true })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Use in Chat' })).not.toBeInTheDocument();
	});

	it('reads text resources and keeps binary resources inspectable', async () => {
		await renderTester('resources', { resources: {} }, (request) => {
			if (request.method === 'resources/list') {
				return {
					resources: [
						{ uri: 'file:///guide.txt', name: 'Guide', mimeType: 'text/plain' },
						{ uri: 'file:///image.bin', name: 'Binary', mimeType: 'application/octet-stream' }
					]
				};
			}
			if (request.method === 'resources/read') {
				return request.params?.uri === 'file:///guide.txt'
					? {
							contents: [
								{ uri: 'file:///guide.txt', mimeType: 'text/plain', text: 'Resource body' }
							]
						}
					: {
							contents: [
								{
									uri: 'file:///image.bin',
									mimeType: 'application/octet-stream',
									blob: 'AAAA'
								}
							]
						};
			}
		});

		await page.getByRole('button', { name: /Guide/ }).click();
		await expect.element(page.getByText('Resource body', { exact: true }).first()).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Use in Chat' })).not.toBeInTheDocument();

		await page.getByRole('button', { name: /Binary/ }).click();
		await expect.element(page.getByRole('button', { name: 'Use in Chat' })).not.toBeInTheDocument();
	});

	it('shows setup guidance without opening an MCP session', async () => {
		appPage.url.searchParams.delete('tab');
		const data = await preparePageData<PageData>({
			server: {
				...fixtures.serverSingle,
				configured: false,
				canConnect: true
			},
			backTarget: `/mcp-servers/s/${fixtures.serverSingle.id}`
		});
		await render(TesterPage, { data });

		await expect
			.element(page.getByRole('heading', { name: 'Server setup required' }))
			.toBeVisible();
		await expect.element(page.getByRole('link', { name: 'Manage server' })).toBeVisible();
	});

	it('marks MCP Log as current and records both handshake directions', async () => {
		await renderTester('logs');

		await expect.element(testerSection('MCP Log')).toHaveClass(/page-tab-active/);
		await expect.element(page.getByRole('list', { name: 'MCP traffic log' })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: /Sent request initialize/ }))
			.toBeVisible();
		await expect
			.element(page.getByRole('button', { name: /Received response initialize/ }))
			.toBeVisible();
	});

	it('keeps the MCP Log tab usable when the session fails to connect', async () => {
		mockMCPInitializationFailure();
		appPage.url.searchParams.set('tab', 'logs');
		const data = await preparePageData<PageData>({
			server: {
				...fixtures.serverSingle,
				configured: true,
				deploymentStatus: 'Available',
				canConnect: true
			},
			backTarget: `/mcp-servers/s/${fixtures.serverSingle.id}`
		});
		await render(TesterPage, { data });

		await expect.element(page.getByRole('alert')).toMatchTextContent('Unavailable');
		await expect
			.element(page.getByRole('button', { name: /transport .*Streamable HTTP error/ }))
			.toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Retry' })).toBeVisible();
	});

	it('shows CLI login and retries a localhost component in the inspector', async () => {
		appPage.url.searchParams.delete('tab');
		mockMCPInitializationFailure(401);
		const attemptURL = `${window.location.origin}/oauth/mcp/login/ui-attempt`;
		let checks = 0;
		worker.use(
			http.get('*/oauth/mcp/login/:state', () => HttpResponse.json({ expiresIn: 600 })),
			http.get(`/api/oauth/vmcp/vmcpi1component/components/${fixtures.serverSingle.id}`, () =>
				HttpResponse.json({ authURL: ++checks === 1 ? attemptURL : '' })
			)
		);

		const server = structuredClone(fixtures.serverSingle);
		server.configured = true;
		server.vmcpInstanceID = 'vmcpi1component';
		server.deploymentStatus = 'Available';
		server.manifest.remoteConfig = {
			url: 'https://mcp.example.com',
			localhostCallbackEnabled: true
		};
		const data = await preparePageData<PageData>({
			server,
			backTarget: `/mcp-servers/s/${server.id}`
		});
		await render(TesterPage, { data });
		await expect
			.element(page.getByLabelText('Authentication command'))
			.toHaveTextContent(`obot mcp login "${attemptURL}"`);
		await expect.element(page.getByRole('timer')).toBeVisible();
		mockMCPInitialization();
		worker.use(http.get('*/oauth/mcp/login/:state', () => new HttpResponse(null, { status: 400 })));
		document.dispatchEvent(new Event('visibilitychange'));
		await expect
			.element(page.getByRole('heading', { name: 'Reauthentication required' }))
			.not.toBeInTheDocument();
	});

	it('keeps management navigation for a legacy localhost deployment without a vMCP owner', async () => {
		appPage.url.searchParams.delete('tab');
		mockMCPInitializationFailure(401);
		const server = structuredClone(fixtures.serverSingle);
		server.configured = true;
		server.deploymentStatus = 'Available';
		server.manifest.remoteConfig = {
			url: 'https://mcp.example.com',
			localhostCallbackEnabled: true
		};
		const data = await preparePageData<PageData>({
			server,
			backTarget: `/mcp-servers/s/${server.id}`
		});
		await render(TesterPage, { data });
		await expect
			.element(page.getByRole('link', { name: 'Manage authentication', exact: true }))
			.toHaveAttribute('href', `/mcp-servers/s/${server.id}`);
		await expect.element(page.getByLabelText('Authentication command')).not.toBeInTheDocument();
	});
});
