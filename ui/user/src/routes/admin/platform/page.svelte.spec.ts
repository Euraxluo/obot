import { page as appPage } from '$app/state';
import { overwriteGetLocale } from '$lib/paraglide/runtime';
import { Group } from '$lib/services';
import type { ImagePullSecret, ImagePullSecretCapability } from '$lib/services/admin/types';
import type { Version } from '$lib/services/user/types';
import { compileAppPreferences } from '$lib/stores/appPreferences.svelte';
import { createMockProfile, preparePageData } from '../../../tests/helpers/pageData';
import { getVersionResponse, listAppPreferencesResponse } from '../../../tests/mocks/data';
import type { PageData } from './$types';
import PlatformPage from './+page.svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

overwriteGetLocale(() => 'en');
async function renderPlatformPage({
	versionOverrides = {},
	view = 'settings',
	create = false,
	capability = { available: false },
	imagePullSecrets = [],
	groups = [Group.ADMIN],
	displayName
}: {
	versionOverrides?: Partial<Version>;
	view?: string;
	create?: boolean;
	capability?: ImagePullSecretCapability;
	imagePullSecrets?: ImagePullSecret[];
	groups?: string[];
	displayName?: string;
} = {}) {
	appPage.url.searchParams.set('view', view);
	if (create) appPage.url.searchParams.set('create', 'true');
	else appPage.url.searchParams.delete('create');

	const data = await preparePageData<PageData>({
		appPreferences: compileAppPreferences(
			displayName ? { ...listAppPreferencesResponse, displayName } : undefined
		),
		profile: createMockProfile(groups),
		appNotification: undefined,
		k8sSettings: undefined,
		capability,
		imagePullSecrets,
		gitCredentials: [],
		version: { ...getVersionResponse, ...versionOverrides }
	});

	return render(PlatformPage, { data });
}

afterEach(() => {
	appPage.url.searchParams.delete('view');
	appPage.url.searchParams.delete('create');
});

describe('Platform Page', () => {
	it('defaults to Settings and removes the License surface', async () => {
		await renderPlatformPage({});

		await expect.element(page.getByRole('tab', { name: 'Settings', exact: true })).toBeVisible();
		await expect
			.element(page.getByRole('tab', { name: 'License', exact: true }))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { name: 'Notifications', exact: true }))
			.toBeVisible();
	});

	it('retains Branding', async () => {
		await renderPlatformPage({ view: 'branding' });

		await expect.element(page.getByRole('tab', { name: 'Branding', exact: true })).toBeVisible();
	});

	it('hides Registry Connections outside Kubernetes', async () => {
		await renderPlatformPage({ capability: { available: true } });

		await expect
			.element(page.getByRole('heading', { name: 'Registry Connections', exact: true }))
			.not.toBeInTheDocument();
	});

	it('renders image pull secrets inside Settings on Kubernetes', async () => {
		await renderPlatformPage({
			capability: { available: true },
			versionOverrides: { engine: 'kubernetes' }
		});

		await expect
			.element(page.getByRole('heading', { name: 'Registry Connections', exact: true }))
			.toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Add Basic Secret', exact: true }))
			.toBeVisible();
	});
});
