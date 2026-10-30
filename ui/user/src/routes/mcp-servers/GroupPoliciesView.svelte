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
	import { obotGroupDisplayName } from '$lib/subjectResolver';
	import { Check, SearchX, Users } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { twMerge } from 'tailwind-merge';

	export type PolicyGroupSubjectType = 'group' | 'obotGroup';

	export interface PolicyGroup {
		id: string;
		name: string;
		subjectType: PolicyGroupSubjectType;
	}

	export const OBOT_ROLE_GROUPS = [
		'basic',
		'power-user',
		'power-user-plus',
		'admin',
		'owner',
		'auditor',
		'authenticated'
	];

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

	let selectedGroup = $state<PolicyGroup>();
	let selectedGroupKey = $derived(
		selectedGroup ? `${selectedGroup.subjectType}:${selectedGroup.id}` : undefined
	);
	let connectorQuery = $state('');
	let saving = $state(false);
	let saveError = $state('');

	export function findDedicatedGroupAcr(
		rules: AccessControlRule[],
		subjectType: PolicyGroupSubjectType,
		groupId: string
	): AccessControlRule | undefined {
		return rules.find(
			(rule) =>
				rule.subjects?.length === 1 &&
				rule.subjects[0].type === subjectType &&
				rule.subjects[0].id === groupId
		);
	}

	export function findSharedGroupAcrs(
		rules: AccessControlRule[],
		subjectType: PolicyGroupSubjectType,
		groupId: string
	): AccessControlRule[] {
		return rules.filter(
			(rule) =>
				rule.subjects?.some((subject) => subject.type === subjectType && subject.id === groupId) &&
				!(
					rule.subjects?.length === 1 &&
					rule.subjects[0].type === subjectType &&
					rule.subjects[0].id === groupId
				)
		);
	}

	function ruleGrantsAllEntries(rule: AccessControlRule) {
		return Boolean(
			rule.resources?.some((resource) => resource.type === 'selector' && resource.id === '*')
		);
	}

	function entryIdsFromRules(rules: AccessControlRule[]) {
		const entries = new SvelteSet<string>();
		for (const rule of rules) {
			for (const resource of rule.resources ?? []) {
				if (resource.type === 'mcpServerCatalogEntry') {
					entries.add(resource.id);
				}
			}
		}
		return entries;
	}

	let dedicatedAcr = $derived(
		selectedGroup
			? findDedicatedGroupAcr(accessControlRules, selectedGroup.subjectType, selectedGroup.id)
			: undefined
	);
	let sharedAcrs = $derived(
		selectedGroup
			? findSharedGroupAcrs(accessControlRules, selectedGroup.subjectType, selectedGroup.id)
			: []
	);
	let dedicatedGrantsAll = $derived(Boolean(dedicatedAcr && ruleGrantsAllEntries(dedicatedAcr)));
	let sharedGrantsAll = $derived(sharedAcrs.some(ruleGrantsAllEntries));
	let selectorGrantsAll = $derived(dedicatedGrantsAll || sharedGrantsAll);
	let dedicatedEntryIds = $derived(entryIdsFromRules(dedicatedAcr ? [dedicatedAcr] : []));
	let inheritedEntryIds = $derived.by(() => {
		const inherited = entryIdsFromRules(sharedAcrs);
		if (sharedGrantsAll) {
			for (const entry of connectors) {
				inherited.add(entry.id);
			}
		}
		return inherited;
	});
	let effectiveAuthorizedCount = $derived.by(() => {
		const ids = new SvelteSet(dedicatedEntryIds);
		for (const id of inheritedEntryIds) ids.add(id);
		if (dedicatedGrantsAll || sharedGrantsAll) return connectors.length;
		return ids.size;
	});
	let sharedSubjectCounts = $derived(
		sharedAcrs.map((rule) => ({
			rule,
			otherSubjects:
				rule.subjects?.filter(
					(subject) =>
						!(
							subject.type === selectedGroup?.subjectType &&
							subject.id === selectedGroup?.id
						)
				).length ?? 0
		}))
	);
	let lockedEntryIds = $derived.by(() => {
		const locked = new SvelteSet(inheritedEntryIds);
		if (dedicatedGrantsAll) {
			for (const entry of connectors) locked.add(entry.id);
		}
		return locked;
	});
	let hasSharedRules = $derived(sharedAcrs.length > 0);
	let lastLoadedGroupKey = $state<string>();
	let selectedEntryIds = $state<SvelteSet<string>>(new SvelteSet());

	$effect(() => {
		const currentKey = selectedGroupKey;
		if (currentKey !== lastLoadedGroupKey) {
			lastLoadedGroupKey = currentKey;
			if (currentKey) {
				selectedEntryIds = new SvelteSet(
					[...dedicatedEntryIds].filter((id) => !lockedEntryIds.has(id))
				);
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

	function groupSubtitle(subjectType: PolicyGroupSubjectType, groupId: string): string | undefined {
		const dedicated = findDedicatedGroupAcr(accessControlRules, subjectType, groupId);
		const shared = findSharedGroupAcrs(accessControlRules, subjectType, groupId);
		if (!dedicated && shared.length === 0) return undefined;
		if ((dedicated && ruleGrantsAllEntries(dedicated)) || shared.some(ruleGrantsAllEntries)) {
			return m.mcps_access_policies_group_connector_count({ count: connectors.length });
		}
		const ids = entryIdsFromRules([...(dedicated ? [dedicated] : []), ...shared]);
		const count = ids.size;
		return count > 0 ? m.mcps_access_policies_group_connector_count({ count }) : undefined;
	}

	function handleSelectGroup(group: PolicyGroup) {
		selectedGroup = group;
		saveError = '';
	}

	function selectAllFiltered() {
		for (const c of filteredConnectors) {
			if (!lockedEntryIds.has(c.id)) selectedEntryIds.add(c.id);
		}
	}

	function clearAll() {
		selectedEntryIds.clear();
	}

	function toggleConnector(id: string, checked: boolean) {
		if (lockedEntryIds.has(id) || selectorGrantsAll) return;
		if (checked) {
			selectedEntryIds.add(id);
		} else {
			selectedEntryIds.delete(id);
		}
	}

	async function save() {
		if (!selectedGroup || saving || selectorGrantsAll) return;
		saving = true;
		saveError = '';

		try {
			const group = selectedGroup;
			const selectedIds = Array.from(selectedEntryIds);
			const entryResources: AccessControlRuleResource[] = selectedIds.map((id) => ({
				type: 'mcpServerCatalogEntry',
				id
			}));

			const existing = findDedicatedGroupAcr(accessControlRules, group.subjectType, group.id);

			if (existing) {
				const preserved = (existing.resources ?? []).filter(
					(r) => r.type !== 'mcpServerCatalogEntry' && !(r.type === 'selector' && r.id === '*')
				);
				const resourceIDs = new SvelteSet(selectedIds);
				const updatedResources = [
					...preserved,
					...[...resourceIDs].map((id) => ({
						type: 'mcpServerCatalogEntry' as const,
						id
					}))
				];

				if (isAdmin) {
					await AdminService.updateAccessControlRule(existing.id, {
						...existing,
						subjects: [{ type: group.subjectType, id: group.id }],
						resources: updatedResources
					});
				} else if (workspaceId) {
					await UserService.updateWorkspaceAccessControlRule(workspaceId, existing.id, {
						...existing,
						subjects: [{ type: group.subjectType, id: group.id }],
						resources: updatedResources
					});
				}
			} else if (selectedIds.length > 0) {
				const manifest: AccessControlRuleManifest = {
					displayName: `Group: ${group.name || group.id}`,
					subjects: [{ type: group.subjectType, id: group.id }],
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
		class="w-full md:w-80 shrink-0 flex flex-col gap-4 border-b md:border-b-0 md:border-r border-base-300 dark:border-base-400 pb-4 md:pb-0 md:pr-4"
	>
		<div class="flex items-center justify-between">
			<h3 class="text-sm font-semibold flex items-center gap-2">
				<Users class="size-4 text-primary" />
				{m.mcps_access_policies_select_group()}
			</h3>
		</div>

		<!-- Built-in Obot Groups Section -->
		<div class="flex flex-col gap-2">
			<div class="flex items-center justify-between px-0.5">
				<span class="text-xs font-semibold text-muted-content uppercase tracking-wider">
					{m.mcps_access_policies_group_section_builtin()}
				</span>
			</div>
			<div class="flex flex-col gap-1.5 max-h-56 overflow-y-auto default-scrollbar-thin pr-0.5">
				{#each OBOT_ROLE_GROUPS as groupId (groupId)}
					{@const isSelected =
						selectedGroup?.subjectType === 'obotGroup' && selectedGroup?.id === groupId}
					{@const subtitleText = groupSubtitle('obotGroup', groupId)}
					<button
						type="button"
						class={twMerge(
							'border-base-300 dark:border-base-400 hover:bg-base-100/5 flex items-center gap-3 rounded-lg border p-2 text-left transition-colors',
							isSelected && 'bg-primary/10 border-primary'
						)}
						onclick={() =>
							handleSelectGroup({
								id: groupId,
								name: obotGroupDisplayName(groupId),
								subjectType: 'obotGroup'
							})}
					>
						<div class="flex grow flex-col min-w-0">
							<div class="flex items-center gap-1.5">
								<span class="font-medium text-xs truncate">{obotGroupDisplayName(groupId)}</span>
								<span
									class="badge badge-ghost badge-xs text-[9px] uppercase tracking-wider shrink-0 opacity-70"
								>
									{m.mcps_access_policies_group_type_builtin()}
								</span>
							</div>
							{#if subtitleText}
								<span class="text-muted-content text-[11px] mt-0.5">{subtitleText}</span>
							{/if}
						</div>
						{#if isSelected}
							<Check class="text-primary size-4 shrink-0" />
						{/if}
					</button>
				{/each}
			</div>
		</div>

		<!-- Directory Groups Section -->
		<div class="flex flex-col gap-2 grow min-h-0">
			<div class="flex items-center justify-between px-0.5">
				<span class="text-xs font-semibold text-muted-content uppercase tracking-wider">
					{m.mcps_access_policies_group_section_directory()}
				</span>
			</div>
			<div class="grow flex flex-col min-h-[220px]">
				<GroupPicker
					onSelect={(g) =>
						handleSelectGroup({
							id: g.id,
							name: g.name,
							subjectType: 'group'
						})}
					selectedId={selectedGroup?.subjectType === 'group' ? selectedGroup.id : undefined}
					subtitle={(g) => groupSubtitle('group', g.id)}
					pageSize={20}
				/>
			</div>
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
						{#if dedicatedAcr}
							<span class="badge badge-sm badge-outline text-xs">
								{m.mcps_access_policies_group_dedicated_policy({ name: dedicatedAcr.displayName })}
							</span>
						{:else}
							<span class="badge badge-sm badge-warning badge-soft text-xs">
								{m.mcps_access_policies_group_no_dedicated_policy()}
							</span>
						{/if}
					</div>
					<p class="text-xs text-muted-content mt-1">
						{m.mcps_access_policies_group_connectors_count({
							selected: effectiveAuthorizedCount,
							total: connectors.length
						})}
					</p>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					<button
						type="button"
						class="btn btn-primary btn-sm min-w-20"
						disabled={saving || isReadonly || selectorGrantsAll}
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

			{#if sharedSubjectCounts.length > 0}
				{#each sharedSubjectCounts as { rule, otherSubjects } (rule.id)}
					<div class="notification-info text-xs p-3 rounded-lg" role="status">
						{m.mcps_access_policies_group_shared_rule_notice({
							name: rule.displayName,
							count: otherSubjects
						})}
					</div>
				{/each}
			{/if}

			{#if hasSharedRules && !dedicatedAcr}
				<div class="notification-warning text-xs p-3 rounded-lg" role="status">
					{m.mcps_access_policies_group_shared_union_notice()}
				</div>
			{/if}

			{#if selectorGrantsAll}
				<div class="notification-warning text-xs p-3 rounded-lg" role="status">
					{m.mcps_access_policies_group_selector_readonly_notice()}
				</div>
			{/if}

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
				{#if !isReadonly && !selectorGrantsAll && connectors.length > 0}
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
						{@const inherited = inheritedEntryIds.has(entry.id) || sharedGrantsAll}
						{@const isChecked =
							inherited || dedicatedGrantsAll || selectedEntryIds.has(entry.id)}
						{@const isLocked = inherited || selectorGrantsAll}
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
								disabled={isReadonly || isLocked}
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
									{#if inherited}
										<span class="badge badge-sm badge-info text-[10px]">
											{m.mcps_access_policies_group_from_shared_rule()}
										</span>
									{:else if isChecked}
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
