<script lang="ts">
	import { SEEN_SPLASH_DIALOG_KEY } from '$lib/constants';
	import { m } from '$lib/i18n';
	import Loading from '$lib/icons/Loading.svelte';
	import { markSeenTimestamp } from '$lib/localstate';
	import { AdminService } from '$lib/services';
	import { version } from '$lib/stores';
	import { adminConfigStore } from '$lib/stores/adminConfig.svelte';
	import Logo from '../Logo.svelte';

	let { onContinue }: { onContinue?: () => void | Promise<void> } = $props();

	let loading = $state(false);

	const storeData = $derived($adminConfigStore);

	async function handleAcceptEula() {
		if (storeData.eulaAccepted) return;
		const response = await AdminService.acceptEula();
		adminConfigStore.updateEula(response.accepted);
	}

	async function handleContinue() {
		loading = true;
		try {
			await handleAcceptEula();
			markSeenTimestamp(SEEN_SPLASH_DIALOG_KEY);
			await onContinue?.();
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex w-full items-center justify-center">
	<Logo class="size-12" />
</div>
<h2 class="mb-6 text-center text-2xl font-semibold">{m.auth_setup_welcome_to_obot()}</h2>

<div class="w-fit self-center px-4">
	{#if !version.current.authEnabled}
		<p class="mb-4">
			<span class="text-muted-content">{m.auth_setup_auth_disabled()}</span>
			<a
				href="https://docs.obot.ai/installation/enabling-authentication"
				rel="external noopener noreferrer"
				target="_blank"
				class="text-link">{m.auth_setup_learn_more()}</a
			>
		</p>
	{/if}
	<p>
		{m.auth_setup_agree_eula_prefix()}
		<a
			href="https://obot.ai/eul"
			rel="external noopener noreferrer"
			target="_blank"
			class="text-link">EULA</a
		>{m.auth_setup_agree_eula_suffix()}
	</p>
</div>

<button
	class="btn btn-primary mt-8 flex justify-center text-center"
	disabled={loading}
	onclick={handleContinue}
>
	{#if loading}
		<Loading class="size-4" />
	{:else}
		{m.core_continue()}
	{/if}
</button>
