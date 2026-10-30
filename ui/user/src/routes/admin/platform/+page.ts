import { handleRouteError } from '$lib/errors';
import {
	AdminService,
	UserService,
	type AppNotification,
	type GitCredential,
	type ImagePullSecret,
	type ImagePullSecretCapability,
	type K8sSettings
} from '$lib/services';
import { defaultAppNotification } from '$lib/stores/appNotification.svelte';
import type { PageLoad } from './$types';

const views = new Set(['branding', 'settings', 'mcp-config']);

let hasHydratedAppNotification = false;

export const load: PageLoad = async ({ fetch, parent, url }) => {
	const {
		profile,
		version,
		appPreferences,
		appNotification: initialAppNotification
	} = await parent();
	const requestedView = url.searchParams.get('view');
	const view = requestedView && views.has(requestedView) ? requestedView : 'settings';

	let appNotification: AppNotification = defaultAppNotification;
	let k8sSettings: K8sSettings | undefined;
	let capability: ImagePullSecretCapability = { available: false };
	let imagePullSecrets: ImagePullSecret[] = [];
	let gitCredentials: GitCredential[] = [];

	switch (view) {
		case 'settings':
			await Promise.all([
				(async () => {
					try {
						let response: AppNotification | undefined;

						if (import.meta.env.SSR && initialAppNotification) {
							response = initialAppNotification;
						} else if (!hasHydratedAppNotification && initialAppNotification) {
							hasHydratedAppNotification = true;
							response = initialAppNotification;
						} else {
							hasHydratedAppNotification = true;
							response = await UserService.getAppNotification({ fetch });
						}

						appNotification = {
							...defaultAppNotification,
							...(response ?? {})
						};
					} catch (err) {
						handleRouteError(err, '/admin/platform?view=settings', profile);
					}
				})(),
				(async () => {
					gitCredentials = await AdminService.listGitCredentials({
						fetch,
						dontLogErrors: true
					}).catch(() => []);
				})(),
				(async () => {
					if (version?.engine !== 'kubernetes') return;
					try {
						[capability, imagePullSecrets] = await Promise.all([
							AdminService.getImagePullSecretCapability({ fetch }),
							AdminService.listImagePullSecrets({ fetch })
						]);
					} catch (err) {
						handleRouteError(err, '/admin/platform?view=settings', profile);
					}
				})()
			]);
			break;
		case 'mcp-config':
			if (version?.engine === 'kubernetes' && !version?.hideK8sDetails) {
				try {
					k8sSettings = await AdminService.listK8sSettings({ fetch });
				} catch (err) {
					handleRouteError(err, '/admin/platform?view=mcp-config', profile);
				}
			}
			break;
	}

	return {
		appPreferences,
		appNotification,
		k8sSettings,
		capability,
		imagePullSecrets,
		gitCredentials
	};
};
