import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { mcpServersAndEntries } from '$lib/stores';
import { createMCPCatalogEntry } from '../../../tests/helpers/mcp';
import ConnectorsMarketplace from './ConnectorsMarketplace.svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';

overwriteGetLocale(() => 'en');

vi.mock('$lib/url', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/url')>();
	return {
		...actual,
		setUrlParamAndUpdateUrl: vi.fn()
	};
});

function renderMarketplace(overrides: { query?: string } = {}) {
	mcpServersAndEntries.current = {
		entries: [
			createMCPCatalogEntry({
				id: 'entry-github',
				name: 'Zenicredit',
				manifest: {
					shortDescription: 'Chinese credit connector',
					metadata: { displayNameZh: ' 水滴征信 ' }
				}
			}),
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
		props: { query: overrides.query ?? '', onQueryChange: vi.fn() }
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
		expect(githubCard?.textContent).toContain('水滴征信');
		expect(githubCard?.textContent).not.toContain('Zenicredit');
		expect(
			document.querySelector('[data-testid="connector-card-entry-slack"]')?.textContent
		).toContain('Slack');
		expect(document.body.textContent).toContain('Use in vMCP');
		expect(
			document.querySelector('a[href="/mcp-servers/c/entry-github?from=connectors"]')
		).not.toBeNull();
	});

	it('searches cards by manifest name', async () => {
		renderMarketplace({ query: 'Slack' });
		await tick();

		expect(document.querySelector('[data-testid="connector-card-entry-slack"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="connector-card-entry-github"]')).toBeNull();
	});

	it('searches cards by the Chinese display name', async () => {
		renderMarketplace({ query: '水滴' });
		await tick();

		expect(document.querySelector('[data-testid="connector-card-entry-github"]')).not.toBeNull();
		expect(document.querySelector('[data-testid="connector-card-entry-slack"]')).toBeNull();
	});
});
