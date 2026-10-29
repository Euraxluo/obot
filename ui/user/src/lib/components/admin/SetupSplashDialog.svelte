<script lang="ts">
	import { page } from '$app/state';
	import { SEEN_SPLASH_DIALOG_KEY } from '$lib/constants';
	import { getSeenTimestamp } from '$lib/localstate';
	import { Group } from '$lib/services';
	import { profile, version } from '$lib/stores';
	import { adminConfigStore } from '$lib/stores/adminConfig.svelte';
	import setupSplash from '$lib/stores/setupSplash.svelte';
	import { goto } from '$lib/url';
	import ResponsiveDialog from '../ResponsiveDialog.svelte';
	import SetupSplashContent from './SetupSplashContent.svelte';
	import { onDestroy } from 'svelte';

	let dialog = $state<ReturnType<typeof ResponsiveDialog>>();
	let splashOpened = $state(false);

	// Block other onboarding dialogs until this splash has either opened or decided not to.
	setupSplash.blocking = true;
	onDestroy(() => {
		setupSplash.blocking = false;
	});

	const setupPath = '/admin/setup';

	const storeData = $derived($adminConfigStore);
	const isAuthProviderConfigured = $derived(
		version.current.authEnabled ? storeData.authProviderConfigured : true
	);
	const isOnSetupPage = $derived(page.url.pathname === setupPath);
	const isBootstrapUser = $derived(profile.current.isBootstrapUser?.() ?? false);

	function releaseSplashBlock() {
		splashOpened = false;
		setupSplash.blocking = false;
	}

	$effect(() => {
		if (!profile.current.loaded || profile.current.unauthorized) {
			return;
		}

		if (!storeData.lastFetched) {
			const mightSeeSplash =
				profile.current.hasAdminAccess?.() ||
				profile.current.isBootstrapUser?.() ||
				profile.current.groups.includes(Group.OWNER);
			if (!mightSeeSplash) {
				setupSplash.blocking = false;
			}
			return;
		}

		const { seenAt: firstTimeViewed } = getSeenTimestamp(
			SEEN_SPLASH_DIALOG_KEY,
			profile.current.created
		);

		const isOwner = profile.current.groups.includes(Group.OWNER);
		const needsSetup =
			!firstTimeViewed &&
			(isBootstrapUser || isOwner) &&
			(!isAuthProviderConfigured || !storeData.eulaAccepted);
		if (needsSetup && !isOnSetupPage) {
			splashOpened = true;
			setupSplash.blocking = true;
			dialog?.open();
			return;
		}

		if (!splashOpened) {
			setupSplash.blocking = false;
		}
	});

	async function finishOnboarding() {
		if (isBootstrapUser && !isAuthProviderConfigured) {
			goto(setupPath);
		}
	}

	async function handleContinue() {
		dialog?.close();
		releaseSplashBlock();
		await finishOnboarding();
	}
</script>

<ResponsiveDialog
	bind:this={dialog}
	hideClose
	disableClickOutside
	class="text-md md:w-sm max-w-full rounded-lg"
	classes={{
		content: 'p-4 justify-center'
	}}
	onClose={releaseSplashBlock}
>
	<SetupSplashContent onContinue={handleContinue} />
</ResponsiveDialog>
