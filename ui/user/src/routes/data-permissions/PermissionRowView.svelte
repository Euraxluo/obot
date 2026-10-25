<script lang="ts">
	import { m } from '$lib/i18n';
	import type { PermissionRow as PermissionRowData } from './permissions.svelte';
	import { ChevronDown, ChevronRight } from '@lucide/svelte';

	interface Props {
		row: PermissionRowData;
		disabled?: boolean;
		expanded?: boolean;
		ontoggle?: () => void;
		onchange: (field: 'view-data' | 'create-queries', value: string) => void;
	}

	let { row, disabled, expanded, ontoggle, onchange }: Props = $props();
</script>

<tr class:font-medium={row.scope === 'database'}>
	<td class="max-w-80 py-2 pr-3" title={row.label}>
		{#if row.scope === 'database'}
			<button class="flex items-center gap-2" type="button" onclick={ontoggle}>
				{#if expanded}<ChevronDown class="size-4" />{:else}<ChevronRight class="size-4" />{/if}
				<span class="truncate">{row.label}</span>
			</button>
		{:else}
			<span class="block truncate" title={row.label}>{row.label}</span>
		{/if}
	</td>
	<td class="py-2 pr-3">
		<select
			class="select select-bordered select-sm w-42"
			aria-label={`${row.label} — ${m.data_permissions_view_data()}`}
			{disabled}
			value={row.viewData}
			onchange={(event) => onchange('view-data', (event.target as HTMLSelectElement).value)}
		>
			<option value="all">{m.data_permissions_view_all()}</option>
			<option value="blocked">{m.data_permissions_view_blocked()}</option>
		</select>
	</td>
	<td class="py-2 pr-3">
		<select
			class="select select-bordered select-sm w-52"
			aria-label={`${row.label} — ${m.data_permissions_create_queries()}`}
			{disabled}
			value={row.createQueries}
			onchange={(event) => onchange('create-queries', (event.target as HTMLSelectElement).value)}
		>
			<option value="query-builder">{m.data_permissions_create_query_builder()}</option>
			<option value="query-builder-and-native">{m.data_permissions_create_native()}</option>
			<option value="no">{m.data_permissions_create_no()}</option>
		</select>
	</td>
</tr>
