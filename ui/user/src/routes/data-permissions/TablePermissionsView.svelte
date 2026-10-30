<script lang="ts">
	import { page } from '$app/state';
	import { m } from '$lib/i18n';
	import Loading from '$lib/icons/Loading.svelte';
	import PermissionRowView from './PermissionRowView.svelte';
	import {
		createGroup,
		getPermissionGraph,
		listDatabases,
		listGroups,
		savePermissionGraph,
		type MetabaseDatabase,
		type MetabaseGroup,
		type MetabaseSettings,
		type PermissionGraph,
		type PermissionValue
	} from './metabase';
	import {
		applyPermission,
		databasesWithChanges,
		permissionRows,
		type PermissionRow
	} from './permissions.svelte';
	import { RefreshCcw, Save, UserPlus } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		settings: MetabaseSettings;
	}

	let { settings }: Props = $props();
	let groups = $state<MetabaseGroup[]>([]);
	let databases = $state<MetabaseDatabase[]>([]);
	let graph = $state<PermissionGraph>();
	let originalGraph = $state<PermissionGraph>();
	let selectedGroupId = $state('');
	let loading = $state(false);
	let saving = $state(false);
	let creatingGroup = $state(false);
	let newGroupName = $state('');
	let error = $state('');
	let notice = $state('');
	let expanded = new SvelteSet<number>();

	let rows = $derived(
		graph && selectedGroupId
			? permissionRows(Number(selectedGroupId), databases, graph).filter(
					(row) => row.scope === 'database' || expanded.has(row.databaseId)
				)
			: []
	);
	let changedDatabaseIds = $derived(
		graph && originalGraph ? databasesWithChanges(graph, originalGraph) : new SvelteSet<number>()
	);
	let hasChanges = $derived(changedDatabaseIds.size > 0);

	function formatError(err: unknown) {
		const detail = err instanceof Error ? err.message : String(err);
		return detail.includes('CORS')
			? m.data_permissions_cors_error()
			: m.data_permissions_request_failed({ error: detail });
	}

	async function load() {
		if (!settings.baseUrl || !settings.adminApiKey) {
			error = m.data_permissions_configure_first();
			return;
		}
		loading = true;
		error = '';
		notice = '';
		try {
			[groups, databases] = await Promise.all([listGroups(settings), listDatabases(settings)]);
			originalGraph = await getPermissionGraph(settings);
			graph = structuredClone($state.snapshot(originalGraph));
			const requestedGroupId = page.url.searchParams.get('group');
			if (requestedGroupId && groups.some((group) => String(group.id) === requestedGroupId)) {
				selectedGroupId = requestedGroupId;
			} else if (!selectedGroupId && groups.length > 0) {
				selectedGroupId = String(groups[0].id);
			}
			expanded.clear();
		} catch (err) {
			error = formatError(err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		if (settings.baseUrl && settings.adminApiKey) void load();
	});

	function updateRow(row: PermissionRow, field: 'view-data' | 'create-queries', value: string) {
		if (!graph || !selectedGroupId) return;
		notice = '';
		graph = applyPermission(graph, Number(selectedGroupId), row, field, value as PermissionValue);
	}

	function toggleDatabase(databaseId: number) {
		if (expanded.has(databaseId)) {
			expanded.delete(databaseId);
		} else {
			expanded.add(databaseId);
		}
	}

	async function save() {
		if (!graph) return;
		saving = true;
		error = '';
		notice = '';
		try {
			const saved = await savePermissionGraph(settings, graph);
			graph = saved;
			originalGraph = structuredClone($state.snapshot(saved));
			notice = m.data_permissions_permissions_saved();
		} catch (err) {
			error = formatError(err);
		} finally {
			saving = false;
		}
	}

	function groupedRows(databaseId: number): PermissionRow[] {
		return rows.filter((row) => row.databaseId === databaseId);
	}

	async function handleCreateGroup() {
		const name = newGroupName.trim();
		if (!name || creatingGroup) return;
		creatingGroup = true;
		error = '';
		notice = '';
		try {
			const group = await createGroup(settings, name);
			const nextGroups = await listGroups(settings);
			groups = nextGroups;
			selectedGroupId = String(group.id);
			newGroupName = '';
			notice = m.data_permissions_group_created({ name: group.name });
		} catch (err) {
			error = formatError(err);
		} finally {
			creatingGroup = false;
		}
	}
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-2 md:flex-row md:items-center">
		<label class="text-sm font-light" for="metabase-permission-group"
			>{m.data_permissions_group()}</label
		>
		<select
			id="metabase-permission-group"
			class="select select-bordered w-64"
			value={selectedGroupId}
			onchange={(event) => {
				selectedGroupId = (event.target as HTMLSelectElement).value;
				notice = '';
			}}
		>
			{#each groups as group (group.id)}
				<option value={String(group.id)}>{group.name}</option>
			{/each}
		</select>
		<button class="btn btn-secondary" type="button" disabled={loading} onclick={load}>
			{#if loading}<Loading class="size-4" />{:else}<RefreshCcw class="size-4" />{/if}
			{m.data_permissions_refresh()}
		</button>
		<button class="btn btn-primary" type="button" disabled={!hasChanges || saving} onclick={save}>
			{#if saving}<Loading class="size-4" />{:else}<Save class="size-4" />{/if}
			{m.core_save()}
		</button>
	</div>
	<div class="flex flex-col gap-2 md:flex-row md:items-center">
		<label class="text-sm font-light" for="metabase-new-group-name"
			>{m.data_permissions_new_group()}</label
		>
		<input
			id="metabase-new-group-name"
			class="input input-bordered w-64"
			type="text"
			bind:value={newGroupName}
			onkeydown={(event) => {
				if (event.key === 'Enter') void handleCreateGroup();
			}}
		/>
		<button
			class="btn btn-secondary"
			type="button"
			disabled={!newGroupName.trim() || creatingGroup}
			onclick={handleCreateGroup}
		>
			{#if creatingGroup}<Loading class="size-4" />{:else}<UserPlus class="size-4" />{/if}
			{m.data_permissions_create_group()}
		</button>
	</div>
	{#if error}<p class="notification-error" role="alert">{error}</p>{/if}
	{#if notice}<p class="notification-success" role="status">{notice}</p>{/if}
	{#if graph}
		<p class="text-xs font-light">{m.data_permissions_revision({ revision: graph.revision })}</p>
		<div class="max-h-[70vh] overflow-auto rounded-lg border border-base-300 dark:border-base-100">
			<table class="table table-sm table-pin-headers">
				<thead>
					<tr>
						<th>{m.data_permissions_database_table()}</th>
						<th>{m.data_permissions_view_data()}</th>
						<th>{m.data_permissions_create_queries()}</th>
					</tr>
				</thead>
				<tbody>
					{#each databases as database (database.id)}
						{#each groupedRows(database.id) as row (row.id)}
							<PermissionRowView
								{row}
								expanded={expanded.has(database.id)}
								ontoggle={() => toggleDatabase(database.id)}
								onchange={(field, value) => updateRow(row, field, value)}
							/>
						{/each}
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
