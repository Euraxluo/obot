import { m } from '$lib/i18n';
import { mcpServersAndEntries } from '$lib/stores';
import { openUrl } from '$lib/utils';
import { createMCPCatalogEntry } from '../../tests/helpers/mcp';
import { preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import EntriesView from './EntriesView.svelte';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

vi.mock('$lib/utils', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/utils')>()),
	openUrl: vi.fn()
}));

const catalogEntry = createMCPCatalogEntry({ id: 'catalog-entry', name: 'Catalog Entry' });
const workspaceEntry = createMCPCatalogEntry({
	id: 'workspace-entry',
	name: 'Workspace Entry',
	powerUserWorkspaceID: 'ws-1'
});

async function renderEntriesView(readonly = false) {
	await preparePageData();
	mcpServersAndEntries.current = {
		entries: [catalogEntry, workspaceEntry],
		servers: [],
		userInstances: [],
		userConfiguredServers: [],
		loading: false,
		lastFetched: null,
		isInitialized: true
	};
	return render(EntriesView, { entity: 'catalog', id: 'default', readonly });
}

function mockMarketPublicationUpdate(handler: (body: unknown) => void) {
	worker.use(
		http.put('/api/mcp-catalogs/default/entries/:entryID', async ({ params, request }) => {
			const body = await request.json();
			handler(body);
			const base = params.entryID === workspaceEntry.id ? workspaceEntry : catalogEntry;
			return HttpResponse.json({ ...base, ...(body as object) });
		})
	);
}

async function clickRow(name: string) {
	await page
		.getByRole('row')
		.filter({ hasText: name })
		.getByText(name, { exact: true })
		.click({ noWaitAfter: true });
}

describe('MCP Servers EntriesView', () => {
	beforeEach(() => {
		vi.mocked(openUrl).mockClear();
	});

	it('opens catalog entries without a workspace id', async () => {
		await renderEntriesView();

		await clickRow('Catalog Entry');

		expect(openUrl).toHaveBeenCalledWith('/mcp-servers/c/catalog-entry', false);
	});

	it('opens workspace-owned entries scoped to their workspace', async () => {
		await renderEntriesView();

		await clickRow('Workspace Entry');

		expect(openUrl).toHaveBeenCalledWith('/mcp-servers/c/workspace-entry?wid=ws-1', false);
	});

	it('omits unavailable row actions', async () => {
		await renderEntriesView(true);

		const row = page.getByRole('row').filter({ hasText: 'Catalog Entry' });
		await expect.element(row.getByRole('button', { name: 'Row actions' })).not.toBeInTheDocument();
		await expect.element(page.getByText('View Audit Logs')).not.toBeInTheDocument();
	});

	it('publishes a single catalog entry from its marketplace toggle', async () => {
		const update = vi.fn();
		mockMarketPublicationUpdate(update);
		await renderEntriesView();

		const row = page.getByRole('row').filter({ hasText: 'Catalog Entry' });
		await row.getByRole('switch', { name: m.mcps_servers_market_publish() }).click();

		await expect.poll(() => update).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ marketPublished: 'true' })
			})
		);
	});

	it('publishes selected catalog entries in bulk', async () => {
		const update = vi.fn();
		mockMarketPublicationUpdate(update);
		await renderEntriesView();

		await page
			.getByRole('row')
			.filter({ hasText: 'Catalog Entry' })
			.getByRole('button')
			.first()
			.click();

		await page.getByRole('button', { name: m.mcps_servers_market_publish_selected() }).click();
		await expect.poll(() => update).toHaveBeenCalledOnce();
	});

	it('unpublishes selected catalog entries in bulk', async () => {
		const publishedEntry = createMCPCatalogEntry({
			id: 'published-entry',
			name: 'Published Entry',
			manifest: { metadata: { marketPublished: 'true' } }
		});
		await preparePageData();
		mcpServersAndEntries.current = {
			entries: [publishedEntry],
			servers: [],
			userInstances: [],
			userConfiguredServers: [],
			loading: false,
			lastFetched: null,
			isInitialized: true
		};
		const update = vi.fn();
		worker.use(
			http.put('/api/mcp-catalogs/default/entries/published-entry', async ({ request }) => {
				const body = await request.json();
				update(body);
				return HttpResponse.json({ ...publishedEntry, ...(body as object) });
			})
		);
		render(EntriesView, { entity: 'catalog', id: 'default' });

		await page
			.getByRole('row')
			.filter({ hasText: 'Published Entry' })
			.getByRole('button')
			.first()
			.click();
		await page.getByRole('button', { name: m.mcps_servers_market_unpublish_selected() }).click();

		await expect.poll(() => update).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ marketPublished: 'false' })
			})
		);
	});
});
