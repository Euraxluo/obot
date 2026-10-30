import { m } from '$lib/i18n';
import { createMCPCatalogEntry } from '../../../tests/helpers/mcp';
import { preparePageData } from '../../../tests/helpers/pageData';
import { worker } from '../../../tests/mocks/worker';
import McpServerEntryForm from './McpServerEntryForm.svelte';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

describe('MCP server entry marketplace listing', () => {
	it('publishes a catalog entry from the overview', async () => {
		await preparePageData();
		const entry = createMCPCatalogEntry({
			id: 'market-entry',
			name: 'Market Entry',
			runtime: 'remote'
		});
		const update = vi.fn();
		worker.use(
			http.post('/api/mcp-catalogs/default/entries/market-entry/reveal', () =>
				HttpResponse.json({})
			),
			http.put('/api/mcp-catalogs/default/entries/market-entry', async ({ request }) => {
				const manifest = await request.json();
				update(manifest);
				return HttpResponse.json({ ...entry, manifest });
			})
		);

		render(McpServerEntryForm, {
			entry,
			id: 'default',
			entity: 'catalog',
			type: 'remote'
		});

		await page.getByRole('switch', { name: m.mcps_servers_market_publish() }).click();

		await expect.poll(() => update).toHaveBeenCalledOnce();
		expect(update).toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ marketPublished: 'true' })
			})
		);
		await expect
			.element(page.getByRole('switch', { name: m.mcps_servers_market_publish() }))
			.toBeChecked();
	});
});
