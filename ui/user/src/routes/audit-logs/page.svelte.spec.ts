import { page as appPage } from '$app/state';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { preparePageData } from '../../tests/helpers/pageData';
import AuditLogsPage from './+page.svelte';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');

describe('Audit logs page Claude Environments', () => {
	it.each([
		{ engine: 'docker' as const, enabled: false, visible: false },
		{ engine: 'kubernetes' as const, enabled: false, visible: false },
		{ engine: 'kubernetes' as const, enabled: true, visible: true }
	])(
		'shows Claude audit logs for $engine with enabled=$enabled',
		async ({ engine, enabled, visible }) => {
			appPage.url.searchParams.delete('view');
			await preparePageData({ version: { engine, claudeEnvironmentsEnabled: enabled } });
			await render(AuditLogsPage);
			const tab = page.getByRole('button', { name: 'Environments', exact: true });
			if (visible) await expect.element(tab).toBeVisible();
			else await expect.element(tab).not.toBeInTheDocument();
		}
	);
});
