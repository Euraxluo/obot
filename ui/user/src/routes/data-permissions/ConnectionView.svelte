<script lang="ts">
	import SensitiveInput from '$lib/components/SensitiveInput.svelte';
	import { m } from '$lib/i18n';
	import Loading from '$lib/icons/Loading.svelte';
	import {
		DEFAULT_METABASE_URL,
		loadSettings,
		saveSettings,
		testConnection,
		type MetabaseSettings
	} from './metabase';
	import { CheckCircle2, Save } from '@lucide/svelte';
	import { untrack } from 'svelte';

	interface Props {
		settings: MetabaseSettings;
		onsave: (settings: MetabaseSettings) => void;
	}

	let { settings, onsave }: Props = $props();
	let draft = $state(untrack(() => ({ ...settings })));
	let testing = $state(false);
	let message = $state('');
	let error = $state('');

	function persist() {
		error = '';
		message = '';
		if (!draft.baseUrl.trim() || !draft.adminApiKey.trim()) {
			error = m.data_permissions_connection_required();
			return;
		}
		const next = { baseUrl: draft.baseUrl.trim(), adminApiKey: draft.adminApiKey };
		saveSettings(next);
		onsave(next);
		message = m.data_permissions_connection_saved();
	}

	async function test() {
		testing = true;
		error = '';
		message = '';
		try {
			await testConnection(draft);
			message = m.data_permissions_connection_success();
		} catch (err) {
			error =
				err instanceof Error && err.message.includes('CORS')
					? m.data_permissions_cors_error()
					: m.data_permissions_connection_failed({
							error: err instanceof Error ? err.message : String(err)
						});
		} finally {
			testing = false;
		}
	}
</script>

<div class="flex max-w-xl flex-col gap-4">
	<div class="flex flex-col gap-1">
		<label class="text-sm font-light" for="metabase-base-url">{m.data_permissions_base_url()}</label
		>
		<input
			id="metabase-base-url"
			class="text-input-filled"
			placeholder={DEFAULT_METABASE_URL}
			bind:value={draft.baseUrl}
		/>
	</div>
	<div class="flex flex-col gap-1">
		<label class="text-sm font-light" for="metabase-admin-key"
			>{m.data_permissions_admin_key()}</label
		>
		<SensitiveInput name="metabase-admin-key" bind:value={draft.adminApiKey} />
		{#if settings.adminApiKey}
			<p class="text-xs font-light">{m.data_permissions_saved_key_masked()}</p>
		{/if}
	</div>
	{#if error}<p class="notification-error" role="alert">{error}</p>{/if}
	{#if message}
		<p class="notification-success flex items-center gap-2" role="status">
			<CheckCircle2 class="size-4" />{message}
		</p>
	{/if}
	<div class="flex gap-2">
		<button class="btn btn-primary" type="button" onclick={persist}>
			<Save class="size-4" />{m.core_save()}
		</button>
		<button class="btn btn-secondary" type="button" disabled={testing} onclick={test}>
			{#if testing}<Loading class="size-4" />{/if}
			{m.data_permissions_test_connection()}
		</button>
	</div>
	<p class="text-xs font-light">{m.data_permissions_browser_storage_risk()}</p>
</div>
