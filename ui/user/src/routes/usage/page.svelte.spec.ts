import { page as appPage } from '$app/state';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { Group } from '$lib/services';
import { createMockProfile, preparePageData } from '../../tests/helpers/pageData';
import { worker } from '../../tests/mocks/worker';
import UsagePage from './+page.svelte';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');

describe('Usage page', () => {
	it('renders MCP usage without a model tab', async () => {
		appPage.url.searchParams.delete('view');
		const mcpStats = vi.fn();
		worker.use(
			http.get('/api/mcp-stats', () => {
				mcpStats();
				return HttpResponse.json({
					items: [],
					timeStart: '',
					timeEnd: '',
					totalCalls: 0,
					uniqueUsers: 0
				});
			})
		);
		await preparePageData({ profile: createMockProfile([Group.USER]) });
		await render(UsagePage);

		await expect.element(page.getByRole('heading', { name: 'No usage stats' })).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Model', exact: true }))
			.not.toBeInTheDocument();
		await vi.waitFor(() => expect(mcpStats).toHaveBeenCalled());
	});
});
