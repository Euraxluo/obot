import { m } from '$lib/i18n';
import { Group } from '$lib/services';
import type { ConnectorAccessRequest, Skill } from '$lib/services';
import { mcpServersAndEntries } from '$lib/stores';
import { createMCPCatalogEntry, createVMCP } from '../../tests/helpers/mcp';
import { createMockProfile, preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import type { PageData } from './$types';
import MarketPage from './+page.svelte';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
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
		goto: (url: string | URL) => applyTestGoto(url)
	};
});

const connectorEntry = createMCPCatalogEntry({
	id: 'mce1-market',
	name: 'Marketplace Connector'
});
connectorEntry.manifest = {
	...connectorEntry.manifest,
	name: 'Marketplace Connector',
	shortDescription: '查询企业信息与工商数据',
	description: '企业信息查询连接器。\n\n示例：「帮我查询杭州的 AI 公司」「查询公司股东结构」',
	metadata: {
		displayNameZh: '企业信息查询',
		categories: '数据,企业'
	}
};

const skill: Skill = {
	id: 'sk1-report',
	type: 'skill',
	name: '周报生成',
	description: '根据本周工作记录生成周报'
};

function requestFixture(
	status: ConnectorAccessRequest['manifest']['status']
): ConnectorAccessRequest {
	return {
		id: 'car1-1',
		created: '2026-10-26T08:00:00.000Z',
		manifest: {
			requesterUserID: 'user-1',
			requesterUsername: 'enduser',
			connectorID: connectorEntry.id,
			connectorName: '企业信息查询',
			mcpCatalogID: 'default',
			status,
			reason: '需要查数据'
		}
	};
}

function mockMarketApis() {
	worker.use(
		http.get('/api/all-mcps/entries', () => HttpResponse.json({ items: [connectorEntry] })),
		http.get('/api/all-mcps/servers', () => HttpResponse.json({ items: [] })),
		http.get('/api/mcp-servers', () => HttpResponse.json({ items: [] })),
		http.get('/api/mcp-server-instances', () => HttpResponse.json({ items: [] }))
	);
}

function resetStore() {
	mcpServersAndEntries.current = {
		entries: [],
		servers: [],
		userInstances: [],
		userConfiguredServers: [],
		loading: false,
		lastFetched: null,
		isInitialized: false
	};
}

async function renderMarketPage({
	requests = [],
	vmcps = [],
	profile = createMockProfile([Group.USER])
}: {
	requests?: ConnectorAccessRequest[];
	vmcps?: PageData['vmcps'];
	profile?: ReturnType<typeof createMockProfile>;
} = {}) {
	resetStore();
	mockMarketApis();
	const data = await preparePageData<PageData>({
		profile,
		skills: [skill],
		vmcps,
		requests
	});
	return render(MarketPage, { data });
}

async function openConnectorsTab() {
	await page.getByRole('tab', { name: m.market_tab_connectors() }).click();
}

describe('market page', () => {
	it('defaults to Skills and renders exactly Skills and Connectors', async () => {
		await renderMarketPage();

		await expect.element(page.getByRole('tab', { name: m.market_tab_skills() })).toBeVisible();
		await expect.element(page.getByRole('tab', { name: m.market_tab_connectors() })).toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: m.market_tab_skills() }))
			.toHaveAttribute('aria-selected', 'true');

		// Skills is the default; expert/shared-vMCP cards are no longer marketplace entries.
		await expect.element(page.getByTestId('market-skill-sk1-report')).toBeVisible();
		await expect.element(page.getByRole('tab', { name: /Experts/ })).not.toBeInTheDocument();

		// Connectors tab lists the entry with a 未连接 pill.
		await openConnectorsTab();
		const card = page.getByTestId(`market-connector-${connectorEntry.id}`);
		await expect.element(card).toBeVisible();
		await expect.element(card.getByText(m.market_not_connected())).toBeVisible();
	});

	it('shows markdown detail with examples and submits a request', async () => {
		const created = requestFixture('pending');
		const submit = vi.fn();
		worker.use(
			http.post('/api/connector-access-requests', () => {
				submit();
				return HttpResponse.json(created, { status: 201 });
			})
		);

		await renderMarketPage();
		await openConnectorsTab();
		await page.getByTestId(`market-connector-${connectorEntry.id}`).click();

		// Markdown description renders as paragraphs, not raw markdown source.
		await expect.element(page.getByText('企业信息查询连接器。')).toBeVisible();

		// 试试这样用 derives quoted prompt lines from the description.
		await expect.element(page.getByText(m.market_try_this())).toBeVisible();
		await expect.element(page.getByText('帮我查询杭州的 AI 公司')).toBeVisible();

		// Filing a request flips the CTA to 审批中.
		await page.getByRole('button', { name: m.market_request_connect() }).click();
		await expect.poll(() => submit).toHaveBeenCalledTimes(1);
		await expect
			.element(page.getByRole('button', { name: m.market_request_pending() }))
			.toBeDisabled();
	});

	it('shows rejected review comments and allows re-requesting', async () => {
		const rejected = {
			...requestFixture('rejected'),
			manifest: {
				...requestFixture('rejected').manifest,
				reviewComment: '暂时不开放'
			}
		};
		await renderMarketPage({ requests: [rejected] });
		await openConnectorsTab();

		await page.getByTestId(`market-connector-${connectorEntry.id}`).click();
		await expect.element(page.getByText(`${m.market_rejected_reason()}：暂时不开放`)).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: m.market_request_connect() }))
			.toBeVisible();
	});

	it('marks connectors composed into a personal vMCP as connected', async () => {
		const profile = createMockProfile([Group.USER]);
		const personal = createVMCP(
			{ id: 'vmcp2-personal', displayName: '我的连接', userID: profile.id },
			[connectorEntry]
		);
		await renderMarketPage({ profile, vmcps: [personal] });

		await openConnectorsTab();
		const card = page.getByTestId(`market-connector-${connectorEntry.id}`);
		await expect.element(card).toBeVisible();
		await expect.element(card.getByText(m.market_connected())).toBeVisible();
	});

	it('creates an approved connector and opens the harness dialog in place', async () => {
		const profile = createMockProfile([Group.USER]);
		const created = createVMCP(
			{
				id: 'vmcp1market',
				displayName: 'Marketplace Connector',
				userID: profile.id
			},
			[connectorEntry]
		);
		const create = vi.fn();
		worker.use(
			http.post('/api/vmcps', async ({ request }) => {
				create(await request.json());
				return HttpResponse.json(created, { status: 201 });
			}),
			http.get('/api/vmcps/vmcp1market', () => HttpResponse.json(created))
		);

		await renderMarketPage({ profile, requests: [requestFixture('approved')] });
		await openConnectorsTab();
		await page.getByTestId(`market-connector-${connectorEntry.id}`).click();
		await page.getByRole('button', { name: m.market_connect() }).click();

		await expect.poll(() => create).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				components: [expect.objectContaining({ mcpServerCatalogEntryID: connectorEntry.id })]
			})
		);
		await expect.element(page.getByCSS('#connect-to-vmcp-dialog')).toBeVisible();
		await expect.element(page.getByText(m.vmcps_connection_url())).toBeVisible();
	});
});
