import { Group } from '$lib/services';
import { createMockProfile } from '../../tests/helpers/pageData';
import { load } from './+page';
import { describe, expect, it, vi } from 'vitest';

describe('MCP Servers page load', () => {
	it('lets a basic user browse without fetching a power-user workspace', async () => {
		const fetch = vi.fn();

		const result = await load({
			fetch,
			url: new URL('https://obot.example/mcp-servers'),
			parent: vi.fn(async () => ({ profile: createMockProfile([Group.USER]) })),
			depends: vi.fn()
		} as unknown as Parameters<typeof load>[0]);

		expect(result).toEqual({
			workspaceId: undefined,
			gitCredentials: [],
			filters: [],
			systemCatalogEntries: [],
			mcpTunnels: [],
			tunnelConnections: undefined,
			accessControlRules: []
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
