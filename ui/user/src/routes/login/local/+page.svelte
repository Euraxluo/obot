<script lang="ts">
	import { browser } from '$app/environment';
	import { productTitle } from '$lib/branding.svelte';
	import Logo from '$lib/components/Logo.svelte';
	import SensitiveInput from '$lib/components/SensitiveInput.svelte';
	import { LOCAL_AUTH_MIN_PASSWORD_LENGTH } from '$lib/constants';
	import { getLocale, m } from '$lib/i18n';
	import { appPreferences, version } from '$lib/stores';
	import type { DevIdentity, DevIdentityCatalog } from './devIdentity';
	import { CircleAlert } from '@lucide/svelte';

	// The form posts to the auth provider, which sets the session cookie and redirects to `rd`.
	// On failure it redirects back here with an `error` message to show.
	let params = $derived(browser ? new URL(window.location.href).searchParams : undefined);
	let rd = $derived(params?.get('rd') ?? '/');
	let error = $derived(params?.get('error'));
	// The email is stashed in sessionStorage on submit so it survives the failed-login redirect.
	// Consume it on every load, and prefill it only on the way back from a failure, so it can't
	// show up on a later, unrelated visit to this page.
	const emailKey = 'local-auth-email';
	function savedEmail() {
		if (!browser) return '';
		const saved = sessionStorage.getItem(emailKey);
		sessionStorage.removeItem(emailKey);
		return error ? (saved ?? '') : '';
	}
	let email = $state(savedEmail());
	let devCatalog = $state<DevIdentityCatalog | undefined>();
	let selectedDevIdentityId = $state('admin');
	let devBusy = $state(false);
	let devError = $state('');

	const devLoginEnabled = $derived(version.current.devLoginEnabled === true);
	const selectedDevIdentity = $derived(
		devCatalog?.identities.find((identity) => identity.roleId === selectedDevIdentityId)
	);
	function fullPageNavigate(destination: string) {
		window.location.assign(destination);
	}

	let { navigate = fullPageNavigate }: { navigate?: (destination: string) => void } = $props();

	async function setDevError(action: () => Promise<void>) {
		devBusy = true;
		devError = '';
		try {
			await action();
		} catch (err) {
			devError = err instanceof Error ? err.message : String(err);
		} finally {
			devBusy = false;
		}
	}

	async function handleEnterIdentity(identity: DevIdentity) {
		const devIdentity = await import('./devIdentity');
		const result = await devIdentity.enterIdentity(identity);
		navigate(result.destination);
	}

	async function handleCreateIdentity() {
		const devIdentity = await import('./devIdentity');
		const result = await devIdentity.createBasicIdentity();
		devCatalog = result.catalog;
		selectedDevIdentityId = 'basic';
		navigate(result.destination);
	}

	$effect(() => {
		if (!devLoginEnabled) return;

		let cancelled = false;
		void setDevError(async () => {
			const devIdentity = await import('./devIdentity');
			const loaded = await devIdentity.prepareDevIdentities();
			if (!cancelled) devCatalog = loaded;
		});
		return () => {
			cancelled = true;
		};
	});
</script>

<svelte:head>
	<title>{productTitle(m.login_local_page_title_suffix())}</title>
</svelte:head>

<div
	class="text-base-content dark:from-base-300 to-base-200 flex h-dvh w-full flex-col items-center justify-center bg-radial-[at_50%_50%] from-gray-50 dark:to-black md:p-0 p-4"
>
	<form
		method="POST"
		action="/oauth2/start"
		onsubmit={() => sessionStorage.setItem(emailKey, email)}
		class="dark:border-base-400 dark:bg-base-200 bg-base-100 flex w-full md:w-sm flex-col gap-4 rounded-xl border border-transparent p-6 shadow-sm"
	>
		<Logo class="h-12 self-center" />
		<h1 class="text-center text-xl font-semibold">
			{m.login_local_heading({ name: appPreferences.current.displayName })}
		</h1>

		{#if error}
			<div class="notification-error flex items-center gap-2">
				<CircleAlert class="text-error size-5 shrink-0" />
				<p class="text-sm font-light">{error}</p>
			</div>
		{/if}

		<input type="hidden" name="rd" value={rd} />
		<input type="hidden" name="locale" value={getLocale()} />

		<label class="flex flex-col gap-1 text-sm font-light" for="local-auth-email">
			{m.common_email()}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="local-auth-email"
				class="text-input-filled"
				type="email"
				name="email"
				autocomplete="username"
				autofocus
				bind:value={email}
				required
			/>
		</label>

		<label class="flex flex-col gap-1 text-sm font-light" for="password">
			{m.common_password()}
			<SensitiveInput
				name="password"
				class="text-input-filled"
				autocomplete="current-password"
				minlength={LOCAL_AUTH_MIN_PASSWORD_LENGTH}
				required
				data1pIgnore={false}
			/>
		</label>

		<button class="btn btn-primary w-full" type="submit">{m.login_local_submit()}</button>

		<p class="text-muted-content text-center text-xs font-light">
			{m.login_local_no_account()}
		</p>
	</form>

	{#if devLoginEnabled}
		<section
			class="dark:border-base-400 dark:bg-base-200 bg-base-100 mt-4 flex w-full md:w-sm flex-col gap-3 rounded-xl border border-dashed p-5"
			aria-labelledby="dev-identity-title"
		>
			<h2 id="dev-identity-title" class="text-sm font-semibold">
				{m.login_dev_identity_title()}
			</h2>

			{#if devError}
				<div class="notification-error flex items-center gap-2">
					<CircleAlert class="text-error size-5 shrink-0" />
					<p class="text-sm font-light">{devError}</p>
				</div>
			{/if}

			<label class="flex flex-col gap-1 text-sm font-light" for="dev-identity">
				{m.login_dev_identity_label()}
				<select
					id="dev-identity"
					class="text-input-filled"
					bind:value={selectedDevIdentityId}
					disabled={devBusy || !devCatalog}
				>
					{#if !devCatalog}
						<option value="admin">{m.login_dev_identity_loading()}</option>
					{:else}
						{#each devCatalog.identities as identity (identity.roleId)}
							<option value={identity.roleId}>
								{identity.label} — {identity.existing
									? identity.email
									: m.login_dev_identity_create_option({ username: identity.username })}
							</option>
						{/each}
					{/if}
				</select>
			</label>

			<div class="flex flex-col gap-2">
				<button
					class="btn btn-secondary w-full"
					type="button"
					disabled={devBusy || !selectedDevIdentity}
					onclick={() =>
						selectedDevIdentity && setDevError(() => handleEnterIdentity(selectedDevIdentity))}
				>
					{m.login_dev_identity_enter()}
				</button>
				<button
					class="btn btn-ghost w-full"
					type="button"
					disabled={devBusy || !devCatalog}
					onclick={() => setDevError(handleCreateIdentity)}
				>
					{m.login_dev_identity_create({ username: devCatalog?.nextUsername ?? 'userN' })}
				</button>
			</div>

			<p class="text-muted-content text-center text-xs font-light">
				{m.login_dev_identity_password_rule({
					username: devCatalog?.nextUsername ?? 'userN',
					password: devCatalog
						? devCatalog.nextUsername + devCatalog.nextUsername.slice(4).repeat(7)
						: '…'
				})}
			</p>
		</section>
	{/if}
</div>
