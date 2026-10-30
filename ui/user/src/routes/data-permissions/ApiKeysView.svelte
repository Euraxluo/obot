<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Confirm from '$lib/components/Confirm.svelte';
	import { m } from '$lib/i18n';
	import Loading from '$lib/icons/Loading.svelte';
	import { createMetabaseMcpForKey, type MetabaseMcpCreationResult } from './key-to-mcp';
	import {
		createApiKey,
		ensureServiceGroup,
		listApiKeys,
		revokeApiKey,
		SERVICE_GROUP_NAME,
		type MetabaseApiKey,
		type MetabaseSettings
	} from './metabase';
	import { KeyRound, Plus, RefreshCcw } from '@lucide/svelte';
	import { onMount } from 'svelte';

	interface Props {
		settings: MetabaseSettings;
	}

	let { settings }: Props = $props();
	let keys = $state<MetabaseApiKey[]>([]);
	let loading = $state(false);
	let creating = $state(false);
	let revokingId = $state<number>();
	let revoking = $state(false);
	let newKeyName = $state('');
	let createdKey = $state('');
	let createdKeyName = $state('');
	let createdGroupId = $state<number>();
	let copied = $state(false);
	let error = $state('');
	let addingToEnv = $state(false);
	let addedMcp = $state<MetabaseMcpCreationResult>();
	let addError = $state('');

	let highlightedKeyName = $derived(page.url.searchParams.get('keyName'));

	async function load() {
		if (!settings.baseUrl || !settings.adminApiKey) {
			error = m.data_permissions_configure_first();
			return;
		}
		loading = true;
		error = '';
		try {
			keys = await listApiKeys(settings);
		} catch (err) {
			error = formatError(err);
		} finally {
			loading = false;
		}
	}

	function formatError(err: unknown) {
		const detail = err instanceof Error ? err.message : String(err);
		return detail.includes('CORS')
			? m.data_permissions_cors_error()
			: m.data_permissions_request_failed({ error: detail });
	}

	async function create() {
		if (!newKeyName.trim()) return;
		creating = true;
		error = '';
		copied = false;
		addedMcp = undefined;
		addError = '';
		try {
			const group = await ensureServiceGroup(settings);
			const key = await createApiKey(settings, newKeyName.trim(), group.id);
			createdKey = key.unmasked_key ?? '';
			createdKeyName = key.name;
			createdGroupId = group.id;
			newKeyName = '';
			await load();
		} catch (err) {
			error = formatError(err);
		} finally {
			creating = false;
		}
	}

	async function revoke() {
		if (!revokingId) return;
		revoking = true;
		try {
			await revokeApiKey(settings, revokingId);
			revokingId = undefined;
			await load();
		} catch (err) {
			error = formatError(err);
		} finally {
			revoking = false;
		}
	}

	async function copyCreatedKey() {
		await navigator.clipboard.writeText(createdKey);
		copied = true;
	}

	async function addToEnvironment() {
		if (!createdKey || !createdKeyName || addingToEnv) return;
		addingToEnv = true;
		addError = '';
		try {
			addedMcp = await createMetabaseMcpForKey({
				keyName: createdKeyName,
				apiKey: createdKey,
				metabaseUrl: settings.baseUrl,
				groupId: createdGroupId
			});
		} catch (err) {
			addError = formatError(err);
		} finally {
			addingToEnv = false;
		}
	}

	function dismissCreatedKey() {
		createdKey = '';
		createdKeyName = '';
		createdGroupId = undefined;
		addedMcp = undefined;
		addError = '';
	}

	onMount(() => {
		if (settings.baseUrl && settings.adminApiKey) void load();
	});
</script>

<div class="flex flex-col gap-4" data-testid="metabase-api-keys">
	<div class="flex flex-col gap-2 md:flex-row md:items-end">
		<div class="flex flex-1 flex-col gap-1">
			<label class="text-sm font-light" for="metabase-api-key-name"
				>{m.data_permissions_key_name()}</label
			>
			<input id="metabase-api-key-name" class="text-input-filled" bind:value={newKeyName} />
		</div>
		<button
			class="btn btn-primary"
			type="button"
			disabled={creating || !newKeyName.trim()}
			onclick={create}
		>
			{#if creating}<Loading class="size-4" />{:else}<Plus class="size-4" />{/if}
			{m.data_permissions_create_key()}
		</button>
		<button class="btn btn-secondary" type="button" disabled={loading} onclick={load}>
			{#if loading}<Loading class="size-4" />{:else}<RefreshCcw class="size-4" />{/if}
			{m.data_permissions_refresh()}
		</button>
	</div>
	<p class="text-xs font-light">
		{m.data_permissions_service_group_note({ name: SERVICE_GROUP_NAME })}
	</p>
	{#if error}<p class="notification-error" role="alert">{error}</p>{/if}
	{#if createdKey}
		<div class="notification-info flex flex-col gap-2 p-3 text-sm">
			<p class="font-medium">{m.data_permissions_created_once()}</p>
			<div class="flex flex-wrap items-center gap-2">
				<code class="flex-1 wrap-break-word">{createdKey}</code>
				<button class="btn btn-xs" type="button" onclick={copyCreatedKey}>
					{copied ? m.data_permissions_copied() : m.data_permissions_copy()}
				</button>
				{#if !addedMcp}
					<button
						class="btn btn-xs btn-primary"
						type="button"
						disabled={addingToEnv}
						data-testid="metabase-add-key-to-env"
						onclick={addToEnvironment}
					>
						{#if addingToEnv}<Loading class="size-4" />{/if}
						{m.data_permissions_add_to_env()}
					</button>
				{/if}
				<button class="btn btn-xs btn-secondary" type="button" onclick={dismissCreatedKey}>
					{m.data_permissions_dismiss()}
				</button>
			</div>
			{#if addError}<p class="text-error" role="alert">{addError}</p>{/if}
			{#if addedMcp}
				<div class="flex flex-wrap items-center gap-2 text-xs" data-testid="metabase-key-mcp-added">
					<span class="font-medium">{addedMcp.displayName}</span>
					<span>{m.data_permissions_add_to_env_done()}</span>
					<a class="link" href={resolve('/vmcps')}>{m.data_permissions_open_vmcps()}</a>
					{#if !addedMcp.environmentAttached}
						<span class="opacity-70">{m.data_permissions_env_attach_skipped()}</span>
					{/if}
					{#if addedMcp.launchError}
						<span class="text-warning">{addedMcp.launchError}</span>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
	<div class="overflow-x-auto">
		<table class="table table-sm">
			<thead>
				<tr>
					<th>{m.data_permissions_key_name()}</th>
					<th>{m.data_permissions_masked_key()}</th>
					<th>{m.data_permissions_group()}</th>
					<th>{m.data_permissions_actions()}</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="4"><Loading class="mx-auto size-5" /></td></tr>
				{:else}
					{#each keys as key (key.id)}
						<tr class={highlightedKeyName === key.name ? 'bg-primary/10' : ''}>
							<td><KeyRound class="mr-2 inline size-4" />{key.name}</td>
							<td>{key.masked_key ?? '—'}</td>
							<td>{key.group?.name ?? '—'}</td>
							<td>
								<button
									class="btn btn-error btn-sm"
									type="button"
									onclick={() => (revokingId = key.id)}
								>
									{m.data_permissions_revoke()}
								</button>
							</td>
						</tr>
					{:else}
						<tr><td colspan="4">{m.data_permissions_no_keys()}</td></tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>
</div>

<Confirm
	show={Boolean(revokingId)}
	msg={m.data_permissions_revoke_confirm()}
	title={m.data_permissions_revoke()}
	submitText={m.data_permissions_revoke()}
	loading={revoking}
	onsuccess={revoke}
	oncancel={() => (revokingId = undefined)}
/>
