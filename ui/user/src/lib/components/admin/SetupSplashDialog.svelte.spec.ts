import { page as appPage } from '$app/state';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { AdminService, Group } from '$lib/services';
import { profile, version } from '$lib/stores';
import { adminConfigStore } from '$lib/stores/adminConfig.svelte';
import { createMockProfile } from '../../../tests/helpers/pageData';
import { getVersionResponse } from '../../../tests/mocks/data';
import { worker } from '../../../tests/mocks/worker';
import SetupSplashDialog from './SetupSplashDialog.svelte';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');
const originalUrl = Object.getOwnPropertyDescriptor(appPage, 'url');

function setUrl(path = '/') {
	Object.defineProperty(appPage, 'url', {
		configurable: true,
		value: new URL(path, window.location.origin)
	});
}

async function configureCompletedWelcome() {
	worker.use(
		http.get('/api/auth-providers', () => HttpResponse.json({ items: [{ configured: true }] })),
		http.get('/api/eula', () => HttpResponse.json({ accepted: true }))
	);
	await adminConfigStore.fetchData(true);
}

async function renderWelcome(groups: string[] = [Group.ADMIN]) {
	profile.initialize(createMockProfile(groups));
	version.initialize(getVersionResponse);
	localStorage.setItem('seenSplashDialog', new Date().toISOString());
	await configureCompletedWelcome();
	return render(SetupSplashDialog);
}

describe('SetupSplashDialog', () => {
	beforeEach(() => {
		setUrl();
	});

	afterEach(() => {
		if (originalUrl) Object.defineProperty(appPage, 'url', originalUrl);
		adminConfigStore.updateAuthProviders([
			{ configured: true } as Awaited<ReturnType<typeof AdminService.listAuthProviders>>[number]
		]);
		adminConfigStore.updateEula(true);
	});

	it('opens for an Owner who still needs onboarding, without telemetry consent', async () => {
		profile.initialize(createMockProfile([Group.OWNER, Group.ADMIN]));
		version.initialize(getVersionResponse);
		localStorage.removeItem('seenSplashDialog');
		worker.use(
			http.get('/api/auth-providers', () => HttpResponse.json({ items: [{ configured: true }] })),
			http.get('/api/eula', () => HttpResponse.json({ accepted: false }))
		);
		await adminConfigStore.fetchData(true);

		await render(SetupSplashDialog);

		await expect.element(page.getByRole('dialog')).toBeVisible();
		expect(document.querySelector('#share-product-usage')).toBeNull();
	});

	it('does not open for a basic user after setup is complete', async () => {
		await renderWelcome([Group.USER]);

		await expect.element(page.getByCSS('dialog')).not.toBeVisible();
	});
});
