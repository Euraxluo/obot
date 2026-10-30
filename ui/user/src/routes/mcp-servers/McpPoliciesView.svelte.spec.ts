import { invalidate } from '$app/navigation';
import { m } from '$lib/i18n';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { Group, type AccessControlRule, type OrgGroup } from '$lib/services';
import { mcpServersAndEntries } from '$lib/stores';
import { createMCPCatalogEntry } from '../../tests/helpers/mcp';
import { createMockProfile, preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import McpPoliciesView from './McpPoliciesView.svelte';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');

vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	invalidate: vi.fn(async () => {})
}));

const entry1 = createMCPCatalogEntry({
	id: 'mce1',
	name: 'Connector One'
});
entry1.manifest = {
	...entry1.manifest,
	name: 'Connector One',
	shortDescription: 'First connector description'
};

const entry2 = createMCPCatalogEntry({
	id: 'mce2',
	name: 'Connector Two'
});
entry2.manifest = {
	...entry2.manifest,
	name: 'Connector Two',
	shortDescription: 'Second connector description'
};

const groupDev: OrgGroup = {
	id: 'group-dev',
	name: 'Developers'
};

const groupOps: OrgGroup = {
	id: 'group-ops',
	name: 'Operations'
};

const devAcr: AccessControlRule = {
	id: 'acr-dev-1',
	created: '2026-01-01T00:00:00Z',
	displayName: 'Group: Developers',
	subjects: [{ type: 'group', id: 'group-dev' }],
	resources: [{ type: 'mcpServerCatalogEntry', id: 'mce1' }]
};

const sharedAcr: AccessControlRule = {
	id: 'acr-shared-1',
	created: '2026-01-02T00:00:00Z',
	displayName: 'Engineering + Ops shared',
	subjects: [
		{ type: 'group', id: 'group-dev' },
		{ type: 'group', id: 'group-ops' }
	],
	resources: [{ type: 'mcpServerCatalogEntry', id: 'mce1' }]
};

function setupStore(entries = [entry1, entry2]) {
	mcpServersAndEntries.current = {
		entries,
		servers: [],
		userInstances: [],
		userConfiguredServers: [],
		loading: false,
		lastFetched: Date.now(),
		isInitialized: true
	};
}

function mockGroupsApi(groups = [groupDev, groupOps]) {
	worker.use(
		http.get('/api/groups', () =>
			HttpResponse.json({
				items: groups,
				nextCursor: undefined,
				source: 'provider',
				degraded: false
			})
		),
		http.get('/api/users', () => HttpResponse.json({ items: [] }))
	);
}

async function renderView(rules: AccessControlRule[] = [devAcr], groups = [groupDev, groupOps]) {
	await preparePageData({
		profile: createMockProfile([Group.ADMIN])
	});
	setupStore();
	mockGroupsApi(groups);
	return render(McpPoliciesView, {
		accessControlRules: rules,
		catalogEntries: [entry1, entry2]
	});
}

describe('McpPoliciesView group-based authorization', () => {
	beforeEach(() => {
		vi.mocked(invalidate).mockClear();
	});

	it('switches between policy rules and group authorization views', async () => {
		await renderView();

		await expect
			.element(page.getByText(m.mcps_access_policies_admin_managed_policies()))
			.toBeVisible();
		await expect(
			page.getByRole('tab', { name: m.mcps_access_policies_mode_rules() })
		).toBeVisible();
		await expect(
			page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() })
		).toBeVisible();

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();

		await expect.element(page.getByText(m.mcps_access_policies_select_group())).toBeVisible();
		await expect
			.element(page.getByText(m.mcps_access_policies_group_prompt_select()))
			.toBeVisible();
	});

	it('loads authorized connectors when a group is selected', async () => {
		await renderView();

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await expect.element(page.getByRole('button', { name: /Developers/ })).toBeVisible();
		await page.getByRole('button', { name: /Developers/ }).click();

		const checkbox1 = page.getByRole('checkbox', { name: 'Connector One' });
		const checkbox2 = page.getByRole('checkbox', { name: 'Connector Two' });

		await expect.element(checkbox1).toBeVisible();
		await expect.element(checkbox1).toBeChecked();

		await expect.element(checkbox2).toBeVisible();
		await expect.element(checkbox2).not.toBeChecked();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_currently_authorized()))
			.toBeVisible();
	});

	it('updates existing access control rule when checking a new connector and saving', async () => {
		const putSpy = vi.fn();
		worker.use(
			http.put(
				'/api/mcp-catalogs/default/access-control-rules/:id',
				async ({ request, params }) => {
					const body = await request.json();
					putSpy({ id: params.id, body });
					return HttpResponse.json({ id: params.id, ...(body as Record<string, unknown>) });
				}
			)
		);

		await renderView();

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Developers/ }).click();

		const checkbox2 = page.getByRole('checkbox', { name: 'Connector Two' });
		await expect.element(checkbox2).not.toBeChecked();
		await checkbox2.click();
		await expect.element(checkbox2).toBeChecked();

		await page.getByRole('button', { name: m.core_save() }).click();

		await vi.waitFor(() => expect(putSpy).toHaveBeenCalledTimes(1));
		expect(putSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'acr-dev-1',
				body: expect.objectContaining({
					resources: expect.arrayContaining([
						{ type: 'mcpServerCatalogEntry', id: 'mce1' },
						{ type: 'mcpServerCatalogEntry', id: 'mce2' }
					])
				})
			})
		);
		await vi.waitFor(() =>
			expect(vi.mocked(invalidate)).toHaveBeenCalledWith('mcp-access-policies:data')
		);
	});

	it('creates a new access control rule for a group without an existing ACR when saving', async () => {
		const postSpy = vi.fn();
		worker.use(
			http.post('/api/mcp-catalogs/default/access-control-rules', async ({ request }) => {
				const body = await request.json();
				postSpy(body);
				return HttpResponse.json({ id: 'acr-new-ops', ...(body as Record<string, unknown>) });
			})
		);

		await renderView();

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: 'Operations' }).click();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_no_dedicated_policy()))
			.toBeVisible();

		const checkbox1 = page.getByRole('checkbox', { name: 'Connector One' });
		await expect.element(checkbox1).not.toBeChecked();
		await checkbox1.click();
		await expect.element(checkbox1).toBeChecked();

		await page.getByRole('button', { name: m.core_save() }).click();

		await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Group: Operations',
				subjects: [{ type: 'group', id: 'group-ops' }],
				resources: [{ type: 'mcpServerCatalogEntry', id: 'mce1' }]
			})
		);
		await vi.waitFor(() =>
			expect(vi.mocked(invalidate)).toHaveBeenCalledWith('mcp-access-policies:data')
		);
	});

	it('filters connectors by search query', async () => {
		await renderView();

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Developers/ }).click();

		await expect.element(page.getByRole('checkbox', { name: 'Connector One' })).toBeVisible();
		await expect.element(page.getByRole('checkbox', { name: 'Connector Two' })).toBeVisible();

		const searchInput = page.getByPlaceholder(m.mcps_access_policies_group_search_connectors());
		await searchInput.fill('Connector Two');

		await expect.element(page.getByRole('checkbox', { name: 'Connector Two' })).toBeVisible();
		await expect
			.element(page.getByRole('checkbox', { name: 'Connector One' }))
			.not.toBeInTheDocument();

		await searchInput.fill('');
		await expect.element(page.getByRole('checkbox', { name: 'Connector One' })).toBeVisible();
		await expect.element(page.getByRole('checkbox', { name: 'Connector Two' })).toBeVisible();
	});

	it('creates a dedicated rule instead of overwriting a shared group rule', async () => {
		const putSpy = vi.fn();
		const postSpy = vi.fn();
		const originalShared = structuredClone(sharedAcr);
		worker.use(
			http.put(
				'/api/mcp-catalogs/default/access-control-rules/:id',
				async ({ request, params }) => {
					putSpy({ id: params.id, body: await request.json() });
					return HttpResponse.json(sharedAcr);
				}
			),
			http.post('/api/mcp-catalogs/default/access-control-rules', async ({ request }) => {
				const body = await request.json();
				postSpy(body);
				return HttpResponse.json({ id: 'acr-dev-dedicated', ...(body as Record<string, unknown>) });
			})
		);

		await renderView([sharedAcr]);

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Developers/ }).click();

		await expect
			.element(
				page.getByText(
					m.mcps_access_policies_group_shared_rule_notice({
						name: sharedAcr.displayName,
						count: 1
					})
				)
			)
			.toBeVisible();

		const inherited = page.getByRole('checkbox', { name: 'Connector One' });
		await expect.element(inherited).toBeChecked();
		await expect.element(inherited).toBeDisabled();

		const newConnector = page.getByRole('checkbox', { name: 'Connector Two' });
		await newConnector.click();
		await page.getByRole('button', { name: m.core_save() }).click();

		await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
		await vi.waitFor(() =>
			expect(vi.mocked(invalidate)).toHaveBeenCalledWith('mcp-access-policies:data')
		);
		expect(putSpy).not.toHaveBeenCalled();
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Group: Developers',
				subjects: [{ type: 'group', id: 'group-dev' }],
				resources: [{ type: 'mcpServerCatalogEntry', id: 'mce2' }]
			})
		);
		expect(sharedAcr).toEqual(originalShared);
	});

	it('shows shared-rule entries as read-only and explains the union on save', async () => {
		await renderView([sharedAcr]);

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Developers/ }).click();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_from_shared_rule()))
			.toBeVisible();
		await expect
			.element(page.getByText(m.mcps_access_policies_group_shared_union_notice()))
			.toBeVisible();
		await expect.element(page.getByRole('checkbox', { name: 'Connector One' })).toBeDisabled();
	});

	it('does not overwrite a selector wildcard rule from the group view', async () => {
		const wildcardAcr: AccessControlRule = {
			id: 'acr-wildcard',
			created: '2026-01-03T00:00:00Z',
			displayName: 'All connectors',
			subjects: [
				{ type: 'group', id: 'group-dev' },
				{ type: 'group', id: 'group-ops' }
			],
			resources: [{ type: 'selector', id: '*' }]
		};
		const originalWildcard = structuredClone(wildcardAcr);
		const putSpy = vi.fn();
		const postSpy = vi.fn();
		worker.use(
			http.put('/api/mcp-catalogs/default/access-control-rules/:id', async ({ request }) => {
				putSpy(await request.json());
				return HttpResponse.json(wildcardAcr);
			}),
			http.post('/api/mcp-catalogs/default/access-control-rules', async ({ request }) => {
				postSpy(await request.json());
				return HttpResponse.json(wildcardAcr);
			})
		);

		await renderView([wildcardAcr]);

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Developers/ }).click();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_selector_readonly_notice()))
			.toBeVisible();
		await expect.element(page.getByRole('checkbox', { name: 'Connector One' })).toBeDisabled();
		await expect.element(page.getByRole('checkbox', { name: 'Connector Two' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: m.core_save() })).toBeDisabled();

		expect(putSpy).not.toHaveBeenCalled();
		expect(postSpy).not.toHaveBeenCalled();
		expect(wildcardAcr).toEqual(originalWildcard);
	});

	it('allows selecting and saving a built-in obotGroup when auth provider returns no groups', async () => {
		const postSpy = vi.fn();
		worker.use(
			http.get('/api/groups', () =>
				HttpResponse.json({
					items: [],
					nextCursor: undefined,
					source: 'provider',
					degraded: false
				})
			),
			http.post('/api/mcp-catalogs/default/access-control-rules', async ({ request }) => {
				const body = await request.json();
				postSpy(body);
				return HttpResponse.json({ id: 'acr-new-basic', ...(body as Record<string, unknown>) });
			})
		);

		await renderView([], []);

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_section_builtin()))
			.toBeVisible();
		await expect
			.element(page.getByText(m.identity_access_groups_none()))
			.toBeVisible();

		await page.getByRole('button', { name: /Obot Basic/ }).click();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_no_dedicated_policy()))
			.toBeVisible();

		const checkbox1 = page.getByRole('checkbox', { name: 'Connector One' });
		await expect.element(checkbox1).not.toBeChecked();
		await checkbox1.click();
		await expect.element(checkbox1).toBeChecked();

		await page.getByRole('button', { name: m.core_save() }).click();

		await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Group: Obot Basic',
				subjects: [{ type: 'obotGroup', id: 'basic' }],
				resources: [{ type: 'mcpServerCatalogEntry', id: 'mce1' }]
			})
		);
		await vi.waitFor(() =>
			expect(vi.mocked(invalidate)).toHaveBeenCalledWith('mcp-access-policies:data')
		);
	});

	it('protects obotGroup=admin with selector=* rule as readonly full grant with disabled save', async () => {
		const adminWildcardAcr: AccessControlRule = {
			id: 'acr-admin-wildcard',
			created: '2026-01-01T00:00:00Z',
			displayName: 'Admin Full Access',
			subjects: [{ type: 'obotGroup', id: 'admin' }],
			resources: [{ type: 'selector', id: '*' }]
		};
		const originalWildcard = structuredClone(adminWildcardAcr);
		const putSpy = vi.fn();
		const postSpy = vi.fn();
		worker.use(
			http.put('/api/mcp-catalogs/default/access-control-rules/:id', async ({ request }) => {
				putSpy(await request.json());
				return HttpResponse.json(adminWildcardAcr);
			}),
			http.post('/api/mcp-catalogs/default/access-control-rules', async ({ request }) => {
				postSpy(await request.json());
				return HttpResponse.json(adminWildcardAcr);
			})
		);

		await renderView([adminWildcardAcr]);

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Obot Admin/ }).click();

		await expect
			.element(page.getByText(m.mcps_access_policies_group_selector_readonly_notice()))
			.toBeVisible();
		await expect.element(page.getByRole('checkbox', { name: 'Connector One' })).toBeChecked();
		await expect.element(page.getByRole('checkbox', { name: 'Connector One' })).toBeDisabled();
		await expect.element(page.getByRole('checkbox', { name: 'Connector Two' })).toBeChecked();
		await expect.element(page.getByRole('checkbox', { name: 'Connector Two' })).toBeDisabled();
		await expect.element(page.getByRole('button', { name: m.core_save() })).toBeDisabled();

		await page.getByRole('button', { name: m.core_save() }).click({ force: true }).catch(() => {});
		expect(putSpy).not.toHaveBeenCalled();
		expect(postSpy).not.toHaveBeenCalled();
		expect(adminWildcardAcr).toEqual(originalWildcard);
	});

	it('protects shared obotGroup rule from being overwritten and marks shared entries as read-only', async () => {
		const sharedObotAcr: AccessControlRule = {
			id: 'acr-shared-obot',
			created: '2026-01-02T00:00:00Z',
			displayName: 'Basic + Power User Shared',
			subjects: [
				{ type: 'obotGroup', id: 'basic' },
				{ type: 'obotGroup', id: 'power-user' }
			],
			resources: [{ type: 'mcpServerCatalogEntry', id: 'mce1' }]
		};
		const originalShared = structuredClone(sharedObotAcr);
		const putSpy = vi.fn();
		const postSpy = vi.fn();
		worker.use(
			http.put(
				'/api/mcp-catalogs/default/access-control-rules/:id',
				async ({ request, params }) => {
					putSpy({ id: params.id, body: await request.json() });
					return HttpResponse.json(sharedObotAcr);
				}
			),
			http.post('/api/mcp-catalogs/default/access-control-rules', async ({ request }) => {
				const body = await request.json();
				postSpy(body);
				return HttpResponse.json({ id: 'acr-basic-dedicated', ...(body as Record<string, unknown>) });
			})
		);

		await renderView([sharedObotAcr]);

		await page.getByRole('tab', { name: m.mcps_access_policies_mode_groups() }).click();
		await page.getByRole('button', { name: /Obot Basic/ }).click();

		await expect
			.element(
				page.getByText(
					m.mcps_access_policies_group_shared_rule_notice({
						name: sharedObotAcr.displayName,
						count: 1
					})
				)
			)
			.toBeVisible();

		const inherited = page.getByRole('checkbox', { name: 'Connector One' });
		await expect.element(inherited).toBeChecked();
		await expect.element(inherited).toBeDisabled();

		const newConnector = page.getByRole('checkbox', { name: 'Connector Two' });
		await newConnector.click();
		await page.getByRole('button', { name: m.core_save() }).click();

		await vi.waitFor(() => expect(postSpy).toHaveBeenCalledTimes(1));
		await vi.waitFor(() =>
			expect(vi.mocked(invalidate)).toHaveBeenCalledWith('mcp-access-policies:data')
		);
		expect(putSpy).not.toHaveBeenCalled();
		expect(postSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				displayName: 'Group: Obot Basic',
				subjects: [{ type: 'obotGroup', id: 'basic' }],
				resources: [{ type: 'mcpServerCatalogEntry', id: 'mce2' }]
			})
		);
		expect(sharedObotAcr).toEqual(originalShared);
	});
});
