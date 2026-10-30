import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { profile } from '$lib/stores';
import { createMockProfile } from '../../tests/helpers/pageData';
import ReLoginDialog from './ReLoginDialog.svelte';
import { expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');
it('opens when an authenticated session expires', async () => {
	profile.initialize({ ...createMockProfile(), expired: true });

	await render(ReLoginDialog);

	await expect.element(page.getByRole('dialog')).toBeVisible();
});
