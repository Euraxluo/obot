import { page as appPage } from '$app/state';
import { m } from '$lib/i18n';
import { Group } from '$lib/services';
import { createMockProfile, preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import type { PageData } from './$types';
import DataPermissionsPage from './+page.svelte';
import { apiKeysViewURL, tablePermissionsViewURL } from './key-to-mcp';
import { STORAGE_KEY } from './metabase';
import { http, HttpResponse } from 'msw';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

vi.mock('$app/state', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$app/state')>();
	const { createAppState } = await import('../../tests/helpers/navigation.svelte');
	return createAppState(actual);
});

vi.mock('$app/navigation', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$app/navigation')>();
	const { applyTestGoto } = await import('../../tests/helpers/navigation.svelte');
	return {
		...actual,
		goto: (url: string | URL) => applyTestGoto(url)
	};
});

vi.mock('$lib/url', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/url')>();
	const { applyTestGoto } = await import('../../tests/helpers/navigation.svelte');
	return {
		...actual,
		clearUrlParams: () => undefined,
		goto: (url: string | URL) => applyTestGoto(url)
	};
});

const adminSettings = {
	baseUrl: 'http://127.0.0.1:3000',
	adminApiKey: 'mb_admin_test_key'
};

const graph = {
	revision: 12,
	groups: {
		'1': {
			'2': {
				'view-data': 'unrestricted',
				'create-queries': 'query-builder-and-native',
				download: { native: 'none' }
			}
		}
	}
};

const requestCount = { keys: 0 };

async function renderPage({
	settings = adminSettings,
	view = 'connection',
	group
}: {
	settings?: typeof adminSettings;
	view?: string;
	group?: string;
} = {}) {
	appPage.url.searchParams.set('view', view);
	if (group) {
		appPage.url.searchParams.set('group', group);
	} else {
		appPage.url.searchParams.delete('group');
	}
	if (settings) {
		localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify({ baseUrl: settings.baseUrl, adminApiKey: settings.adminApiKey })
		);
	}
	const data = await preparePageData<PageData>({
		profile: createMockProfile([Group.ADMIN])
	});
	return render(DataPermissionsPage, { data: data as never });
}

afterEach(() => {
	appPage.url.searchParams.delete('view');
	appPage.url.searchParams.delete('group');
	vi.clearAllMocks();
});

describe('Data permissions', () => {
	it('saves and tests the direct Metabase connection', async () => {
		const properties = vi.fn(() => HttpResponse.json({ 'site-name': 'Metabase' }));
		worker.use(http.get('http://127.0.0.1:3000/api/session/properties', properties));
		localStorage.removeItem(STORAGE_KEY);
		await renderPage({ settings: undefined });

		await page
			.getByRole('textbox', { name: m.data_permissions_base_url() })
			.fill('http://127.0.0.1:3000/');
		await page
			.getByRole('textbox', { name: m.data_permissions_admin_key() })
			.fill('mb_admin_test_key');
		await page.getByRole('button', { name: m.core_save() }).click();

		expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({
			baseUrl: 'http://127.0.0.1:3000',
			adminApiKey: 'mb_admin_test_key'
		});
		await page.getByRole('button', { name: m.data_permissions_test_connection() }).click();
		await expect.element(page.getByText(m.data_permissions_connection_success())).toBeVisible();
		expect(properties).toHaveBeenCalledTimes(1);
	});

	it('creates and reveals a service-group API key once', async () => {
		const createGroup = vi.fn(() => HttpResponse.json({ id: 9, name: 'ztocc_service_group' }));
		const createKey = vi.fn(async ({ request }) => {
			expect(await request.json()).toEqual({ name: 'Warehouse bot', group_id: 9 });
			return HttpResponse.json({
				id: 55,
				name: 'Warehouse bot',
				unmasked_key: 'mb_live_one_time',
				masked_key: 'mb_live…'
			});
		});
		worker.use(
			http.get('http://127.0.0.1:3000/api/permissions/group', () => HttpResponse.json([])),
			http.post('http://127.0.0.1:3000/api/permissions/group', createGroup),
			http.get('http://127.0.0.1:3000/api/api-key', () =>
				HttpResponse.json(
					requestCount.keys++ === 0
						? [
								{
									id: 1,
									name: 'Existing',
									masked_key: 'mb_existing…',
									group: { id: 9, name: 'ztocc_service_group' }
								}
							]
						: []
				)
			),
			http.post('http://127.0.0.1:3000/api/api-key', createKey),
			http.delete(
				'http://127.0.0.1:3000/api/api-key/1',
				() => new HttpResponse(null, { status: 204 })
			)
		);
		await renderPage({ view: 'api-keys' });
		await tick();

		await expect.element(page.getByText('Existing')).toBeVisible();
		await page
			.getByRole('button', { name: m.data_permissions_revoke(), exact: false })
			.first()
			.click();
		await page
			.getByRole('button', { name: m.data_permissions_revoke(), exact: false })
			.last()
			.click();
		await expect.element(page.getByText(m.data_permissions_no_keys())).toBeVisible();
		await page.getByRole('textbox', { name: m.data_permissions_key_name() }).fill('Warehouse bot');
		await page.getByRole('button', { name: m.data_permissions_create_key() }).click();
		await expect.element(page.getByText('mb_live_one_time')).toBeVisible();
		expect(createGroup).toHaveBeenCalledTimes(1);
		expect(createKey).toHaveBeenCalledTimes(1);
	});

	it('shows unrestricted values, creates a group, and saves the graph with revision', async () => {
		let groupList = [{ id: 1, name: 'All Users' }];
		const postGroup = vi.fn(async ({ request }) => {
			expect(await request.json()).toEqual({ name: 'Warehouse editors' });
			const group = { id: 8, name: 'Warehouse editors' };
			groupList = [...groupList, group];
			return HttpResponse.json(group);
		});
		let permissionGraph = structuredClone(graph);
		const newGroupGraph = structuredClone({
			...graph,
			groups: {
				...graph.groups,
				'8': graph.groups['1']
			}
		});
		const putGraph = vi.fn(async ({ request }) => {
			const body = await request.json();
			expect(body.revision).toBe(12);
			expect(body.groups['1']['2']['view-data']).toBe('blocked');
			expect(body.groups['1']['2'].download).toEqual({ native: 'none' });
			permissionGraph = body;
			return HttpResponse.json({ ...body, revision: 13 });
		});
		worker.use(
			http.get('http://127.0.0.1:3000/api/permissions/group', () => HttpResponse.json(groupList)),
			http.post('http://127.0.0.1:3000/api/permissions/group', postGroup),
			http.get('http://127.0.0.1:3000/api/database', () =>
				HttpResponse.json({
					data: [
						{
							id: 2,
							name: 'Warehouse',
							tables: [
								{ id: 31, name: 'orders', schema: 'public' },
								{ id: 32, name: 'shipments', schema: 'public' }
							]
						}
					],
					total: 1
				})
			),
			http.get('http://127.0.0.1:3000/api/permissions/graph', () =>
				HttpResponse.json(groupList.at(-1)?.id === 8 ? newGroupGraph : permissionGraph)
			),
			http.put('http://127.0.0.1:3000/api/permissions/graph', putGraph)
		);
		await renderPage({ view: 'table-permissions' });
		await tick();

		const viewData = page.getByRole('combobox', {
			name: `Warehouse — ${m.data_permissions_view_data()}`
		});
		await expect.element(viewData).toHaveValue('unrestricted');
		await expect
			.element(
				page.getByRole('combobox', {
					name: `Warehouse — ${m.data_permissions_create_queries()}`
				})
			)
			.toHaveValue('query-builder-and-native');
		await expect.element(page.getByRole('button', { name: /Warehouse/ })).toBeVisible();
		await page.getByRole('button', { name: /Warehouse/ }).click();
		await expect
			.element(
				page.getByRole('combobox', {
					name: `public.orders — ${m.data_permissions_view_data()}`
				})
			)
			.toHaveValue('unrestricted');
		await expect
			.element(
				page.getByRole('combobox', {
					name: `public.orders — ${m.data_permissions_create_queries()}`
				})
			)
			.toHaveValue('query-builder-and-native');
		await page.getByRole('button', { name: /Warehouse/ }).click();
		await expect.element(page.getByText('public.orders')).not.toBeInTheDocument();
		await expect.element(page.getByText('public.shipments')).not.toBeInTheDocument();
		await page
			.getByRole('textbox', { name: m.data_permissions_new_group() })
			.fill('Warehouse editors');
		await page.getByRole('button', { name: m.data_permissions_create_group() }).click();
		await expect
			.element(page.getByText(m.data_permissions_group_created({ name: 'Warehouse editors' })))
			.toBeVisible();
		await expect
			.element(page.getByRole('combobox', { name: m.data_permissions_group() }))
			.toHaveValue('8');
		await page.getByRole('combobox', { name: m.data_permissions_group() }).selectOptions('1');
		await page
			.getByRole('combobox', {
				name: `Warehouse — ${m.data_permissions_view_data()}`
			})
			.selectOptions('blocked');
		await page.getByRole('button', { name: m.core_save() }).click();
		await expect.element(page.getByText(m.data_permissions_permissions_saved())).toBeVisible();
		await expect
			.element(page.getByText(m.data_permissions_revision({ revision: 13 })))
			.toBeVisible();
		expect(putGraph).toHaveBeenCalledTimes(1);
	});

	const metabaseCatalogEntry = {
		id: 'mcps/default/obot-metabase',
		created: '2026-01-01T00:00:00.000Z',
		type: 'mcpServerCatalogEntry',
		isCatalogEntry: true,
		manifest: {
			name: 'Metabase',
			shortDescription: 'Metabase',
			description: '',
			icon: '',
			runtime: 'npx',
			npxConfig: { package: '@serdnaley/metabase-mcp', args: [] },
			config: [
				{
					name: 'Metabase Url',
					key: 'METABASE_URL',
					description: 'Metabase base URL',
					required: true,
					sensitive: false,
					usage: 'env',
					value: 'http://host.docker.internal:3000'
				},
				{
					name: 'Metabase Api Key',
					key: 'METABASE_API_KEY',
					description: 'Metabase API key',
					required: true,
					sensitive: true,
					usage: 'env',
					value: ''
				},
				{
					name: 'Npm Config Registry',
					key: 'npm_config_registry',
					description: 'Registry',
					required: false,
					sensitive: false,
					usage: 'env',
					value: 'https://registry.npmmirror.com',
					static: true
				}
			]
		}
	};

	it('adds a Metabase MCP connection to the environment from the revealed key', async () => {
		const createKey = vi.fn(() =>
			HttpResponse.json({
				id: 55,
				name: 'Warehouse bot',
				unmasked_key: 'mb_live_one_time',
				masked_key: 'mb_live…',
				group: { id: 9, name: 'ztocc_service_group' }
			})
		);
		const createVmcp = vi.fn(async ({ request }) => {
			const body = await request.json();
			expect(body.displayName).toBe('Warehouse bot Metabase');
			expect(body.description).toContain(
				`[${m.data_permissions_mcp_view_key_link()}](${apiKeysViewURL('Warehouse bot')})`
			);
			expect(
				body.description.includes(
					`[${m.data_permissions_mcp_view_group_link()}](${tablePermissionsViewURL(9)})`
				)
			).toBe(true);
			const configuration = Object.fromEntries(
				body.components[0].configuration.map((field: { key: string; value: string }) => [
					field.key,
					field.value
				])
			);
			expect(configuration.METABASE_API_KEY).toBe('mb_live_one_time');
			expect(configuration.METABASE_URL).toBe('http://host.docker.internal:3000');
			return HttpResponse.json({
				id: 'vmcp1metabase',
				created: '2026-01-01T00:00:00.000Z',
				displayName: body.displayName,
				description: body.description,
				components: [],
				profiles: []
			});
		});
		const updateEnvironment = vi.fn(async ({ request }) => {
			const body = await request.json();
			expect(body.profiles[0].mcpServerIDs).toContain('vmcp1metabase');
			return HttpResponse.json(body);
		});
		worker.use(
			http.get('http://127.0.0.1:3000/api/permissions/group', () =>
				HttpResponse.json([{ id: 9, name: 'ztocc_service_group' }])
			),
			http.get('http://127.0.0.1:3000/api/api-key', () => HttpResponse.json([])),
			http.post('http://127.0.0.1:3000/api/api-key', createKey),
			http.get('/api/all-mcps/entries', () => HttpResponse.json({ items: [metabaseCatalogEntry] })),
			http.get('/api/vmcps', () => HttpResponse.json({ items: [] })),
			http.post('/api/vmcps', createVmcp),
			http.post('/api/vmcps/vmcp1metabase/launch', () => HttpResponse.json({})),
			http.get('/api/claude-environments', () =>
				HttpResponse.json({
					enabled: true,
					environments: [
						{
							id: 'claude-env-1',
							displayName: 'Default',
							organizationID: 'org-1',
							environmentID: 'env-1',
							claudeTagEnabled: false,
							runtime: {},
							profiles: [
								{
									name: 'default',
									subjects: [],
									mcpServerIDs: [],
									resources: {}
								}
							]
						}
					]
				})
			),
			http.put('/api/claude-environments/claude-env-1', updateEnvironment)
		);
		await renderPage({ view: 'api-keys' });
		await tick();

		await page.getByRole('textbox', { name: m.data_permissions_key_name() }).fill('Warehouse bot');
		await page.getByRole('button', { name: m.data_permissions_create_key() }).click();
		await expect.element(page.getByText('mb_live_one_time')).toBeVisible();
		await page.getByRole('button', { name: m.data_permissions_add_to_env() }).click();
		await expect.element(page.getByText('Warehouse bot Metabase')).toBeVisible();
		await expect.element(page.getByText(m.data_permissions_add_to_env_done())).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: m.data_permissions_open_vmcps() }))
			.toHaveAttribute('href', '/vmcps');
		expect(createVmcp).toHaveBeenCalledTimes(1);
		expect(updateEnvironment).toHaveBeenCalledTimes(1);
	});

	it('preselects the group from the url parameter on table permissions', async () => {
		worker.use(
			http.get('http://127.0.0.1:3000/api/permissions/group', () =>
				HttpResponse.json([
					{ id: 1, name: 'All Users' },
					{ id: 9, name: 'ztocc_service_group' }
				])
			),
			http.get('http://127.0.0.1:3000/api/database', () => HttpResponse.json({ data: [] })),
			http.get('http://127.0.0.1:3000/api/permissions/graph', () =>
				HttpResponse.json(structuredClone(graph))
			)
		);
		await renderPage({ view: 'table-permissions', group: '9' });
		await tick();

		await expect
			.element(page.getByRole('combobox', { name: m.data_permissions_group() }))
			.toHaveValue('9');
	});
});
