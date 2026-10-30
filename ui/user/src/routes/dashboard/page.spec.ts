import { Group, UserService } from '$lib/services';
import { createMockProfile } from '../../tests/helpers/pageData';
import { load } from './+page';
import { describe, expect, it, vi } from 'vitest';

describe('dashboard page load', () => {
	it('keeps basic users on the dashboard', async () => {
		vi.spyOn(UserService, 'listDeviceScans').mockResolvedValue({
			items: null,
			total: 0,
			limit: 1,
			offset: 0
		});

		const result = await load({
			fetch: vi.fn(),
			parent: vi.fn(async () => ({ profile: createMockProfile([Group.USER]) }))
		} as unknown as Parameters<typeof load>[0]);

		expect(result).toEqual({ hasDeviceScans: false });
	});
});
