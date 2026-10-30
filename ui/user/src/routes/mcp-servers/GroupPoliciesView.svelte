<script lang="ts">
	import { invalidate } from '$app/navigation';
	import Search from '$lib/components/Search.svelte';
	import GroupPicker from '$lib/components/admin/GroupPicker.svelte';
	import McpServerIcon from '$lib/components/vmcps/McpServerIcon.svelte';
	import { m } from '$lib/i18n';
	import Loading from '$lib/icons/Loading.svelte';
	import {
		AdminService,
		UserService,
		type AccessControlRule,
		type AccessControlRuleManifest,
		type AccessControlRuleResource,
		type MCPCatalogEntry,
		type OrgGroup
	} from '$lib/services';
	import { catalogEntryDisplayName } from '$lib/services/vmcps/utils';
	import { mcpServersAndEntries, profile } from '$lib/stores';
	import { success } from '$lib/stores/success';
	import { SearchX, Users } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		accessControlRules: AccessControlRule[];
		catalogEntries?: MCPCatalogEntry[];
		workspaceId?: string;
		onSaved?: () => void;
	}

	let { accessControlRules, catalogEntries, workspaceId, onSaved }: Props = $props();

	let isAdmin = $derived(profile.current.hasAdminAccess?.());
	let isReadonly = $derived(profile.current.isAdminReadonly?.());

	onMount(async () => {
		if (!mcpServersAndEntries.current.isInitialized && !mcpServersAndEntries.current.loading) {
			await mcpServersAndEntries.initialize({ scope: isAdmin ? 'admin' : 'user' });
		}
	});

	let connectors = $derived(
		(catalogEntries ?? mcpServersAndEntries.current.entries).filter(
			(entry) => entry.manifest.runtime !== 'vmcp' && !entry.deleted
		)
	);

	let selectedGroup = $state<OrgGroup>();
	let connectorQuery = $state('');
	let saving = $state(false);
	let saveError = $state('');

	export function findGroupAcr(
		rules: AccessControlRule[],
		groupId: string,
		groupName?: string
	): AccessControlRule | undefined {
		const exactGroupOnly = rules.find(
			(r) =>
				r.subjects?.length === 1 && r.subjects[0].type === 'group' && r.subjects[0].id === groupId
		);
		if (exactGroupOnly) return exactGroupOnly;

		const namedGroup = rules.find(
			(r) =>
				(r.displayName === `Group: ${groupName}` || r.displayName === `Group: ${groupId}`) &&
				r.subjects?.some((s) => s.type === 'group' && s.id === groupId)
		);
		if (namedGroup) return namedGroup;

		return rules.find((r) => r.subjects?.some((s) => s.type === 'group' && s.id === groupId));
	}

	let currentAcr = $derived(
		selectedGroup
			? findGroupAcr(accessControlRules, selectedGroup.id, selectedGroup.name)
			: undefined
	);

	let assignedEntryIds = $derived.by(() => {
		const set = new SvelteSet<string>();
		if (!currentAcr) return set;
		const hasAll = currentAcr.resources?.some((r) => r.type === 'selector' && r.id === '*');
		if (hasAll) {
			for (const entry of connectors) {
				set.add(entry.id);
			}
		} else {
			for (const res of currentAcr.resources ?? []) {
				if (res.type === 'mcpServerCatalogEntry') {
					set.add(res.id);
				}
			}
		}
		return set;
	});

	let lastLoadedGroupId = $state<string>();
	let selectedEntryIds = $state<SvelteSet<string>>(new SvelteSet());

	$effect(() => {
		const groupId = selectedGroup?.id;
		if (groupId !== lastLoadedGroupId) {
			lastLoadedGroupId = groupId;
			if (groupId) {
				selectedEntryIds = new SvelteSet(assignedEntryIds);
			} else {
				selectedEntryIds = new SvelteSet();
			}
		}
	});

	let sortedConnectors = $derived(
		[...connectors].sort((a, b) =>
			(catalogEntryDisplayName(a) ?? '').localeCompare(catalogEntryDisplayName(b) ?? '', 'zh')
		)
	);

	let filteredConnectors = $derived(
		sortedConnectors.filter((entry) => {
			if (!connectorQuery.trim()) return true;
			const q = connectorQuery.trim().toLowerCase();
			const name = (catalogEntryDisplayName(entry) || entry.manifest.name || '').toLowerCase();
			const desc = (
				entry.manifest.shortDescription ||
				entry.manifest.description ||
				''
			).toLowerCase();
			const cat = (entry.manifest.metadata?.categories || '').toLowerCase();
			return name.includes(q) || desc.includes(q) || cat.includes(q);
		})
	);

	function groupSubtitle(group: OrgGroup): string | undefined {
		const acr = findGroupAcr(accessControlRules, group.id, group.name);
		if (!acr) return undefined;
		const hasAll = acr.resources?.some((r) => r.type === 'selector' && r.id === '*');
		if (hasAll) {
			return m.mcps_access_policies_group_connector_count({ count: connectors.length });
		}
		const count = acr.resources?.filter((r) => r.type === 'mcpServerCatalogEntry').length ?? 0;
		return count > 0 ? m.mcps_access_policies_group_connector_count({ count }) : undefined;
	}

	function handleSelectGroup(group: OrgGroup) {
		selectedGroup = group;
		saveError = '';
	}

	function selectAllFiltered() {
		for (const c of filteredConnectors) {
			selectedEntryIds.add(c.id);
		}
	}

	function clearAll() {
		selectedEntryIds.clear();
	}

	function toggleConnector(id: string, checked: boolean) {
		if (checked) {
			selectedEntryIds.add(id);
		} else {
			selectedEntryIds.delete(id);
		}
	}

	async function save() {
		if (!selectedGroup || saving) return;
		saving = true;
		saveError = '';

		try {
			const group = selectedGroup;
			const selectedIds = Array.from(selectedEntryIds);
			const entryResources: AccessControlRuleResource[] = selectedIds.map((id) => ({
				type: 'mcpServerCatalogEntry',
				id
			}));

			const existing = findGroupAcr(accessControlRules, group.id, group.name);

			if (existing) {
				const preserved = (existing.resources ?? []).filter(
					(r) => r.type !== 'mcpServerCatalogEntry' && !(r.type === 'selector' && r.id === '*')
				);
				const updatedResources = [...preserved, ...entryResources];

				if (isAdmin) {
					await AdminService.updateAccessControlRule(existing.id, {
						...existing,
						resources: updatedResources
					});
				} else if (workspaceId) {
					await UserService.updateWorkspaceAccessControlRule(workspaceId, existing.id, {
						...existing,
						resources: updatedResources
					});
				}
			} else if (selectedIds.length > 0) {
				const manifest: AccessControlRuleManifest = {
					displayName: `Group: ${group.name || group.id}`,
					subjects: [{ type: 'group', id: group.id }],
					resources: entryResources
				};

				if (isAdmin) {
					await AdminService.createAccessControlRule(manifest);
				} else if (workspaceId) {
					await UserService.createWorkspaceAccessControlRule(workspaceId, manifest);
				}
			}

			success.add(m.mcps_access_policies_group_saved());
			onSaved?.();
			await invalidate('mcp-access-policies:data');
		} catch (err) {
			saveError = err instanceof Error ? err.message : m.core_an_error_occurred();
		} finally {
			saving = false;
		}
	}
</script>

<div class="flex flex-col md:flex-row gap-6 min-h-[500px]">
	<!-- Left panel: Group selection -->
	<div
		class="w-full md:w-80 shrink-0 flex flex-col gap-3 border-b md:border-b-0 md:border-r border-base-300 dark:border-base-400 pb-4 md:pb-0 md:pr-4"
	>
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold flex items-center gap-2">
				<Users class="size-4 text-primary" />
				{m.mcps_access_policies_select_group()}
			</h3>
		</div>
		<div class="grow flex flex-col min-h-0">
			<GroupPicker
				onSelect={(g) => handleSelectGroup(g)}
				selectedId={selectedGroup?.id}
				subtitle={groupSubtitle}
				pageSize={20}
			/>
		</div>
	</div>

	<!-- Right panel: Connectors checklist -->
	<div class="flex-1 min-w-0 flex flex-col gap-4">
		{#if !selectedGroup}
			<div class="my-16 flex flex-col items-center gap-3 self-center text-center">
				<Users class="text-muted-content size-16 opacity-30" />
				<h4 class="text-muted-content text-base font-semibold">
					{m.mcps_access_policies_group_prompt_select()}
				</h4>
				<p class="text-muted-content text-xs font-light max-w-sm">
					{m.mcps_access_policies_group_prompt_select_desc()}
				</p>
			</div>
		{:else}
			<!-- Selected Group Header & Actions -->
			<div
				class="bg-base-100 dark:bg-base-200 border border-base-300 dark:border-base-400 rounded-xl p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3"
			>
				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<span class="font-semibold text-base truncate">{selectedGroup.name}</span>
						{#if currentAcr}
							<span class="badge badge-sm badge-outline text-xs">
								{m.mcps_access_policies_group_dedicated_policy({ name: currentAcr.displayName })}
							</span>
						{:else}
							<span class="badge badge-sm badge-warning badge-soft text-xs">
								{m.mcps_access_policies_group_no_dedicated_policy()}
							</span>
						{/if}
					</div>
					<p class="text-xs text-muted-content mt-1">
						{m.mcps_access_policies_group_connectors_count({
							selected: selectedEntryIds.size,
							total: connectors.length
						})}
					</p>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					<button
						type="button"
						class="btn btn-primary btn-sm min-w-20"
						disabled={saving || isReadonly}
						onclick={save}
					>
						{#if saving}
							<Loading class="size-4" />
						{:else}
							{m.core_save()}
						{/if}
					</button>
				</div>
			</div>

			{#if saveError}
				<div class="notification-error text-xs p-3 rounded-lg">
					{saveError}
				</div>
			{/if}

			<!-- Search & Quick Selection Controls -->
			<div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
				<div class="max-w-md grow">
					<Search
						value={connectorQuery}
						onChange={(val) => (connectorQuery = val)}
						placeholder={m.mcps_access_policies_group_search_connectors()}
						class="h-9 text-xs rounded-lg border-base-300/70 bg-base-100 dark:bg-base-300 shadow-sm"
					/>
				</div>
				{#if !isReadonly && connectors.length > 0}
					<div class="flex items-center gap-2 shrink-0">
						<button type="button" class="btn btn-ghost btn-xs text-xs" onclick={selectAllFiltered}>
							{m.mcps_access_policies_group_select_all()}
						</button>
						<span class="text-base-300 dark:text-base-400">|</span>
						<button type="button" class="btn btn-ghost btn-xs text-xs" onclick={clearAll}>
							{m.mcps_access_policies_group_clear_all()}
						</button>
					</div>
				{/if}
			</div>

			<!-- Connectors Checklist -->
			{#if filteredConnectors.length === 0}
				<div
					class="bg-base-100 dark:bg-base-200 text-muted-content flex flex-col items-center gap-2 rounded-xl p-8 text-center border border-base-300 dark:border-base-400"
				>
					<SearchX class="size-8 opacity-40" />
					<p class="text-sm">{m.mcps_access_policies_group_empty_connectors()}</p>
				</div>
			{:else}
				<div class="flex flex-col gap-2 max-h-[600px] overflow-y-auto default-scrollbar-thin pr-1">
					{#each filteredConnectors as entry (entry.id)}
						{@const isChecked = selectedEntryIds.has(entry.id)}
						{@const wasAssigned = assignedEntryIds.has(entry.id)}
						{@const displayName = catalogEntryDisplayName(entry) || entry.manifest.name}
						<label
							for={`connector-checkbox-${entry.id}`}
							class={twMerge(
								'flex items-center gap-3 p-3 rounded-xl border border-base-300 dark:border-base-400 bg-base-100 dark:bg-base-200 hover:border-primary/50 transition-colors cursor-pointer',
								isChecked && 'border-primary/40 bg-primary/5 dark:bg-primary/10'
							)}
						>
							<input
								type="checkbox"
								id={`connector-checkbox-${entry.id}`}
								aria-label={displayName}
								class="checkbox checkbox-primary checkbox-sm shrink-0"
								checked={isChecked}
								disabled={isReadonly}
								onchange={(e) => toggleConnector(entry.id, e.currentTarget.checked)}
							/>
							<McpServerIcon
								icon={entry.manifest.icon}
								width={36}
								height={36}
								classes={{ root: 'size-9 rounded-lg bg-primary/10 shrink-0' }}
								class="size-5"
							/>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium text-sm truncate">
										{displayName}
									</span>
									{#if wasAssigned}
										<span class="badge badge-sm badge-success text-[10px]">
											{m.mcps_access_policies_group_currently_authorized()}
										</span>
									{/if}
								</div>
								{#if entry.manifest.shortDescription || entry.manifest.description}
									<p class="text-xs text-muted-content line-clamp-1 mt-0.5">
										{entry.manifest.shortDescription || entry.manifest.description}
									</p>
								{/if}
							</div>
							{#if entry.manifest.metadata?.categories}
								<span class="text-xs text-muted-content shrink-0 hidden sm:inline">
									{entry.manifest.metadata.categories}
								</span>
							{/if}
						</label>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
