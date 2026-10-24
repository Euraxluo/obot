import { mcpServersAndEntries } from '$lib/stores';
import { createMCPCatalogEntry } from '../../../tests/helpers/mcp';
import ConnectorsMarketplace from './ConnectorsMarketplace.svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { tick } from 'svelte';

vi.mock('$lib/url', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/url')>();
	return {
		...actual,
		setUrlParamAndUpdateUrl: vi.fn()
	};
});

function renderMarketplace() {
	mcpServersAndEntries.current = {
		entries: [
			createMCPCatalogEntry({ id: 'entry-github', name: 'GitHub' }),
			createMCPCatalogEntry({ id: 'entry-slack', name: 'Slack' })
		],
		servers: [],
		userInstances: [],
		userConfiguredServers: [],
		loading: false,
		lastFetched: null,
		isInitialized: true
	};

	return render(ConnectorsMarketplace, {
		props: { query: '', onQueryChange: vi.fn() }
	});
}

afterEach(() => {
	mcpServersAndEntries.current = {
		entries: [],
		servers: [],
		userInstances: [],
		userConfiguredServers: [],
		loading: false,
		lastFetched: null,
		isInitialized: false
	};
});

describe('ConnectorsMarketplace', () => {
	it('shows catalog cards and inline details', async () => {
		renderMarketplace();

		const githubCard = document.querySelector<HTMLButtonElement>(
			'[data-testid="connector-card-entry-github"]'
		);
		expect(githubCard).not.toBeNull();
		githubCard?.click();
		await tick();

		expect(document.body.textContent).toContain('Connector Marketplace');
		expect(document.body.textContent).toContain('GitHub');
		expect(document.body.textContent).toContain('Use in vMCP');
		expect(
			document.querySelector('a[href="/mcp-servers/c/entry-github?from=connectors"]')
		).not.toBeNull();
	});
});
