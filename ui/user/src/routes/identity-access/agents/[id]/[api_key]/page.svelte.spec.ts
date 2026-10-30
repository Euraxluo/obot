import { page as appPage } from '$app/state';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { ApiKeysService, Group } from '$lib/services';
import type { APIKey } from '$lib/services/api-keys/types';
import { createMockProfile, preparePageData } from '../../../../../tests/helpers/pageData';
import { worker } from '../../../../../tests/mocks/worker';
import type { PageData } from './$types';
import { load } from './+page';
import AgentAuthScopeApiKeyPage from './+page.svelte';
import { isRedirect } from '@sveltejs/kit';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');

const apiKey: APIKey = {
	id: 42,
	userId: 7,
	name: 'Test Agent Scope',
	canAccessAPI: false,
	canAccessSkills: false,
	canAccessDeviceScans: false,
	createdAt: '2026-01-01T00:00:00.000Z'
};

const apiKeyPrefix = `ok1-${apiKey.userId}-${apiKey.id}-*****`;

function loadAgentAuthScopeApiKey(groups: string[]) {
	const profile = createMockProfile(groups);
	return load({
		fetch: vi.fn(),
		params: { id: apiKey.id.toString(), api_key: apiKeyPrefix },
		parent: vi.fn(async () => ({ profile }))
	} as unknown as Parameters<typeof load>[0]);
}

function mockMcpLogApis() {
	const requests = { mcpAuditLogs: undefined as string | undefined };
	worker.use(
		http.get('/api/mcp-audit-logs', ({ request }) => {
			requests.mcpAuditLogs = request.url;
			return HttpResponse.json({ items: [], total: 0 });
		}),
		http.get('/api/mcp-audit-logs/filter-options/:filter', () => HttpResponse.json({ options: [] }))
	);
	return requests;
}

async function renderApiKeyPage() {
	const requests = mockMcpLogApis();
	const data = await preparePageData<PageData>({
		apiKey,
		apiKeyId: apiKeyPrefix,
		profile: createMockProfile([Group.ADMIN])
	});
	render(AgentAuthScopeApiKeyPage, { data });
	return requests;
}

afterEach(() => {
	appPage.url.searchParams.delete('start');
	appPage.url.searchParams.delete('end');
	vi.restoreAllMocks();
});

describe('Agent Identity API key load', () => {
	it('redirects users without admin access', async () => {
		const getApiKey = vi.spyOn(ApiKeysService, 'getApiKey');
		const getAnyApiKey = vi.spyOn(ApiKeysService, 'getAnyApiKey');

		try {
			await loadAgentAuthScopeApiKey([Group.USER]);
			expect.unreachable('expected a redirect');
		} catch (err) {
			expect(isRedirect(err)).toBe(true);
			if (isRedirect(err)) {
				expect(err.status).toBe(302);
				expect(err.location).toBe('/');
			}
		}

		expect(getApiKey).not.toHaveBeenCalled();
		expect(getAnyApiKey).not.toHaveBeenCalled();
	});

	it('gets any scope for users with admin access', async () => {
		const getApiKey = vi.spyOn(ApiKeysService, 'getApiKey');
		const getAnyApiKey = vi.spyOn(ApiKeysService, 'getAnyApiKey').mockResolvedValue(apiKey);

		const result = await loadAgentAuthScopeApiKey([Group.ADMIN]);

		expect(result).toEqual({ apiKey, apiKeyId: apiKeyPrefix, isAdmin: true });
		expect(getApiKey).not.toHaveBeenCalled();
		expect(getAnyApiKey).toHaveBeenCalledWith(apiKey.id.toString(), expect.any(Object));
	});
});

describe('Agent Identity API key MCP log page', () => {
	it('shows only MCP logs for this API key', async () => {
		const requests = await renderApiKeyPage();

		await expect.element(page.getByText('No MCP server logs', { exact: true })).toBeVisible();
		await vi.waitFor(() => expect(requests.mcpAuditLogs).toBeTruthy());

		const params = new URL(requests.mcpAuditLogs!).searchParams;
		expect(params.get('api_key_id')).toBe(String(apiKey.id));
		expect(params.get('start_time')).toBeTruthy();
		expect(params.get('end_time')).toBeTruthy();
	});

	it('falls back to the default range when start/end URL params are invalid', async () => {
		appPage.url.searchParams.set('start', 'not-a-date');
		appPage.url.searchParams.set('end', 'also-invalid');

		const requests = await renderApiKeyPage();

		await expect.element(page.getByText('No MCP server logs', { exact: true })).toBeVisible();
		await vi.waitFor(() => expect(requests.mcpAuditLogs).toBeTruthy());

		const params = new URL(requests.mcpAuditLogs!).searchParams;
		expect(() => new Date(params.get('start_time')!).toISOString()).not.toThrow();
		expect(() => new Date(params.get('end_time')!).toISOString()).not.toThrow();
	});
});
