<script lang="ts">
	import { page } from '$app/state';
	import { productTitle } from '$lib/branding.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import Search from '$lib/components/Search.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import MarketItemCard from '$lib/components/market/MarketItemCard.svelte';
	import MarketplaceGrid from '$lib/components/marketplace/MarketplaceGrid.svelte';
	import McpServerIcon from '$lib/components/vmcps/McpServerIcon.svelte';
	import { m } from '$lib/i18n';
	import { toHTMLFromMarkdownWithNewTabLinks } from '$lib/markdown';
	import { UserService, type ConnectorAccessRequest, type Skill, type VMCP } from '$lib/services';
	import {
		catalogEntryDisplayName,
		entryCategories,
		matchesQuery,
		sortMcpServers
	} from '$lib/services/vmcps/utils';
	import { mcpServersAndEntries, profile } from '$lib/stores';
	import { goto, setUrlParamAndUpdateUrl } from '$lib/url';
	import { Bot, CircleAlert, Lightbulb, Sparkles } from '@lucide/svelte';
	import { onMount } from 'svelte';

	let { data } = $props();

	type Tab = 'experts' | 'skills' | 'connectors';

	type SelectedItem = {
		tab: Tab;
		id: string;
		title: string;
		description: string;
		iconURL?: string;
		tags: string[];
		href?: string;
		entryID?: string;
	};

	let activeTab = $state<Tab>(tabFromURL());
	let query = $state('');
	let selected = $state<SelectedItem>();
	let requests = $state<ConnectorAccessRequest[]>([]);
	let reasonText = $state('');
	let submitting = $state(false);
	let submitError = $state('');

	onMount(() => {
		if (!mcpServersAndEntries.current.isInitialized) {
			mcpServersAndEntries.initialize({ scope: 'user' });
		}
	});

	// Keep the fetched request list in sync when returning from the connect flow.
	$effect(() => {
		requests = data.requests;
	});

	function tabFromURL(): Tab {
		const tab = page.url.searchParams.get('tab');
		return tab === 'skills' || tab === 'connectors' ? tab : 'experts';
	}

	function switchTab(tab: Tab) {
		activeTab = tab;
		setUrlParamAndUpdateUrl(page.url, 'tab', tab === 'experts' ? null : tab);
	}

	// --- Connectors ---

	let allEntries = $derived(
		mcpServersAndEntries.current.entries.filter(
			(entry) => entry.manifest.runtime !== 'vmcp' && !entry.deleted
		)
	);
	let visibleEntries = $derived(
		sortMcpServers(
			allEntries.filter((entry) => !query || matchesQuery(entry, query)),
			'popularity',
			query
		)
	);

	/** Latest request per connector, keyed by connector ID. */
	let requestByConnector = $derived.by(() => {
		const byConnector = new Map<string, ConnectorAccessRequest>();
		for (const request of requests) {
			const existing = byConnector.get(request.manifest.connectorID);
			if (!existing || (request.created ?? '') > (existing.created ?? '')) {
				byConnector.set(request.manifest.connectorID, request);
			}
		}
		return byConnector;
	});

	/** Entry IDs the user already composed into a personal vMCP. */
	let connectedEntryIDs = $derived.by(() => {
		const connected = new Set<string>();
		for (const vmcp of data.vmcps) {
			if (vmcp.userID !== profile.current.id) continue;
			for (const component of vmcp.components ?? []) {
				if (component.mcpServerCatalogEntryID) {
					connected.add(component.mcpServerCatalogEntryID);
				}
			}
		}
		return connected;
	});

	type ConnectorState = 'none' | 'pending' | 'approved' | 'rejected' | 'connected';

	function connectorState(entryID: string): ConnectorState {
		if (connectedEntryIDs.has(entryID)) return 'connected';
		const request = requestByConnector.get(entryID);
		if (!request) return 'none';
		return request.manifest.status;
	}

	function connectorStatus(entryID: string) {
		switch (connectorState(entryID)) {
			case 'connected':
				return { label: m.market_connected(), tone: 'success' as const };
			case 'pending':
				return { label: m.market_request_pending(), tone: 'warning' as const };
			case 'rejected':
				return { label: m.market_rejected(), tone: 'error' as const };
			default:
				return { label: m.market_not_connected(), tone: 'neutral' as const };
		}
	}

	// --- Experts (admin-built shared vMCPs) ---

	let sharedVmcps = $derived(
		data.vmcps.filter((vmcp) => !vmcp.userID && (vmcp.profiles?.length ?? 0) > 0)
	);
	let visibleExperts = $derived(
		sharedVmcps.filter(
			(vmcp) =>
				!query ||
				vmcp.displayName.toLowerCase().includes(query.toLowerCase()) ||
				(vmcp.description ?? '').toLowerCase().includes(query.toLowerCase())
		)
	);

	// --- Skills ---

	let visibleSkills = $derived(
		data.skills.filter(
			(skill) =>
				!query ||
				(skill.name ?? skill.displayName ?? '').toLowerCase().includes(query.toLowerCase()) ||
				(skill.description ?? '').toLowerCase().includes(query.toLowerCase())
		)
	);

	function skillTitle(skill: Skill) {
		return skill.name || skill.displayName || m.market_untitled_skill();
	}

	// --- Detail dialog ---

	function openConnector(entryID: string) {
		const entry = allEntries.find((candidate) => candidate.id === entryID);
		if (!entry) return;
		selected = {
			tab: 'connectors',
			id: entry.id,
			title: catalogEntryDisplayName(entry) || m.market_untitled_connector(),
			description: entry.manifest.description || entry.manifest.shortDescription || '',
			iconURL: entry.manifest.icon,
			tags: entryCategories(entry),
			entryID: entry.id
		};
		reasonText = '';
		submitError = '';
	}

	function openExpert(vmcp: VMCP) {
		selected = {
			tab: 'experts',
			id: vmcp.id,
			title: vmcp.displayName || m.market_untitled_expert(),
			description: vmcp.description ?? '',
			tags: []
		};
	}

	function openSkill(skill: Skill) {
		selected = {
			tab: 'skills',
			id: skill.id,
			title: skillTitle(skill),
			description: skill.description ?? '',
			tags: skill.repoURL ? [skill.repoURL] : []
		};
	}

	function closeDetail() {
		selected = undefined;
	}

	async function submitRequest() {
		if (!selected?.entryID || submitting) return;
		submitting = true;
		submitError = '';
		try {
			const created = await UserService.createConnectorAccessRequest(
				selected.entryID,
				reasonText.trim() || undefined
			);
			requests = [...requests, created];
			reasonText = '';
		} catch (err) {
			submitError = err instanceof Error ? err.message : m.market_request_failed();
		} finally {
			submitting = false;
		}
	}

	function connectConnector() {
		if (!selected?.entryID) return;
		closeDetail();
		goto(`/vmcps?new=true&entry=${encodeURIComponent(selected.entryID)}`);
	}

	function openVmcps() {
		closeDetail();
		goto('/vmcps');
	}

	function openSkillDetail() {
		if (!selected) return;
		const id = selected.id;
		closeDetail();
		goto(`/skills/${encodeURIComponent(id)}`);
	}

	function openExpertDetail() {
		if (!selected) return;
		const id = selected.id;
		closeDetail();
		goto(`/vmcps/${encodeURIComponent(id)}`);
	}

	/** "试试这样用" examples: explicit metadata first, then quoted prompt lines
	 * from the description. Derived from source content only. */
	function usageExamples(item: SelectedItem | undefined): string[] {
		if (!item) return [];
		const entry = item.entryID ? allEntries.find((e) => e.id === item.entryID) : undefined;
		const fromMeta = entry?.manifest.metadata?.usageExamples
			?.split(/[|\n]/)
			.map((example: string) => example.trim())
			.filter(Boolean);
		if (fromMeta?.length) return fromMeta.slice(0, 3);
		const quoted = [...item.description.matchAll(/[「"']([^「」"']{6,})[」"']/g)].map((match) =>
			match[1].trim()
		);
		return quoted.slice(0, 3);
	}

	let selectedDescriptionHTML = $derived(
		selected?.description ? toHTMLFromMarkdownWithNewTabLinks(selected.description) : ''
	);
	let selectedExamples = $derived(usageExamples(selected));
	let selectedRequest = $derived(
		selected?.entryID ? requestByConnector.get(selected.entryID) : undefined
	);

	let searchPlaceholder = $derived(
		activeTab === 'experts'
			? m.market_search_experts()
			: activeTab === 'skills'
				? m.market_search_skills()
				: m.market_search_connectors()
	);

	const tabs: { value: Tab; label: string }[] = [
		{ value: 'experts', label: m.market_tab_experts() },
		{ value: 'skills', label: m.market_tab_skills() },
		{ value: 'connectors', label: m.market_tab_connectors() }
	];
</script>

<svelte:head>
	<title>{productTitle(m.market_title())}</title>
</svelte:head>

<Layout
	title={m.market_title()}
	subtitle={m.market_subtitle()}
	hideSidebar={true}
	showBackButton={false}
>
	<div class="flex min-h-full flex-col gap-4">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div role="tablist" class="flex items-center gap-1" aria-label={m.market_title()}>
				{#each tabs as tab (tab.value)}
					<button
						type="button"
						role="tab"
						aria-selected={activeTab === tab.value}
						data-testid={`market-tab-${tab.value}`}
						class="rounded-full px-4 py-2 text-sm font-medium transition-colors {activeTab ===
						tab.value
							? 'bg-base-100 dark:bg-base-300 text-base-content shadow-sm'
							: 'text-muted-content hover:bg-base-100/60 hover:text-base-content'}"
						onclick={() => switchTab(tab.value)}
					>
						{tab.label}
					</button>
				{/each}
			</div>
			<Search
				value={query}
				onChange={(value) => (query = value)}
				placeholder={searchPlaceholder}
				class="h-10 w-full rounded-lg border-base-300/70 bg-base-100 shadow-sm md:max-w-md"
			/>
		</div>

		{#if activeTab === 'connectors'}
			{#if mcpServersAndEntries.current.loading && allEntries.length === 0}
				<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{#each Array.from({ length: 6 }) as _, index (index)}
						<Skeleton type="card" class="h-36 rounded-xl" />
					{/each}
				</div>
			{:else if visibleEntries.length === 0}
				<p class="text-muted-content py-16 text-center text-sm">{m.market_empty_connectors()}</p>
			{:else}
				<MarketplaceGrid>
					{#each visibleEntries as entry (entry.id)}
						{@const state = connectorState(entry.id)}
						<MarketItemCard
							testId={`market-connector-${entry.id}`}
							title={catalogEntryDisplayName(entry) || m.market_untitled_connector()}
							description={entry.manifest.shortDescription || entry.manifest.description}
							tags={entryCategories(entry)}
							status={connectorStatus(entry.id)}
							onSelect={() => openConnector(entry.id)}
						>
							{#snippet icon()}
								<McpServerIcon
									icon={entry.manifest.icon}
									width={40}
									height={40}
									classes={{ root: 'size-10 rounded-lg' }}
								/>
							{/snippet}
						</MarketItemCard>
					{/each}
				</MarketplaceGrid>
			{/if}
		{:else if activeTab === 'skills'}
			{#if visibleSkills.length === 0}
				<p class="text-muted-content py-16 text-center text-sm">{m.market_empty_skills()}</p>
			{:else}
				<MarketplaceGrid>
					{#each visibleSkills as skill (skill.id)}
						<MarketItemCard
							testId={`market-skill-${skill.id}`}
							title={skillTitle(skill)}
							description={skill.description ?? ''}
							onSelect={() => openSkill(skill)}
						>
							{#snippet icon()}
								<span
									class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg"
								>
									<Bot class="size-5" />
								</span>
							{/snippet}
						</MarketItemCard>
					{/each}
				</MarketplaceGrid>
			{/if}
		{:else}
			{#if visibleExperts.length === 0}
				<p class="text-muted-content py-16 text-center text-sm">{m.market_empty_experts()}</p>
			{:else}
				<MarketplaceGrid>
					{#each visibleExperts as vmcp (vmcp.id)}
						<MarketItemCard
							testId={`market-expert-${vmcp.id}`}
							title={vmcp.displayName || m.market_untitled_expert()}
							description={vmcp.description ?? ''}
							onSelect={() => openExpert(vmcp)}
						>
							{#snippet icon()}
								<span
									class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg"
								>
									<Sparkles class="size-5" />
								</span>
							{/snippet}
						</MarketItemCard>
					{/each}
				</MarketplaceGrid>
			{/if}
		{/if}
	</div>
</Layout>

{#if selected}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={selected.title}>
		<div class="modal-box bg-base-100 dark:bg-base-200 max-w-lg rounded-2xl">
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-center gap-3">
					{#if selected.tab === 'connectors'}
						<McpServerIcon
							icon={selected.iconURL}
							width={40}
							height={40}
							classes={{ root: 'size-10 rounded-lg' }}
						/>
					{:else}
						<span
							class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg"
						>
							{#if selected.tab === 'skills'}
								<Bot class="size-5" />
							{:else}
								<Sparkles class="size-5" />
							{/if}
						</span>
					{/if}
					<h2 class="text-lg font-semibold">{selected.title}</h2>
				</div>
				<button
					type="button"
					class="btn btn-ghost btn-sm btn-circle"
					aria-label={m.market_close()}
					onclick={closeDetail}
				>
					✕
				</button>
			</div>

			{#if selected.description}
				<div class="prose prose-sm mt-4 max-w-none break-words text-sm">
					{@html selectedDescriptionHTML}
				</div>
			{/if}

			{#if selectedExamples.length > 0}
				<div class="mt-5">
					<p class="text-muted-content flex items-center gap-1.5 text-sm font-medium">
						<Lightbulb class="size-4" />
						{m.market_try_this()}
					</p>
					<ul class="mt-2 flex flex-col gap-2">
						{#each selectedExamples as example (example)}
							<li class="bg-base-200/70 rounded-xl px-3 py-2 text-sm">{example}</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if selected.tab === 'connectors' && selected.entryID}
				{@const state = connectorState(selected.entryID)}
				<div class="divider"></div>
				<div class="flex flex-col gap-2">
					{#if state === 'rejected' && selectedRequest?.manifest.reviewComment}
						<p class="text-error flex items-center gap-1.5 text-sm">
							<CircleAlert class="size-4" />
							{m.market_rejected_reason()}：{selectedRequest.manifest.reviewComment}
						</p>
					{/if}

					{#if state === 'connected'}
						<div class="flex items-center justify-between gap-2">
							<span class="text-primary text-sm font-medium">{m.market_connected()}</span>
							<button type="button" class="btn btn-primary btn-sm rounded-lg" onclick={openVmcps}>
								{m.vmcps()}
							</button>
						</div>
					{:else if state === 'pending'}
						<button type="button" disabled class="btn btn-neutral btn-sm w-full rounded-lg">
							{m.market_request_pending()}
						</button>
					{:else if state === 'approved'}
						<button
							type="button"
							class="btn btn-primary btn-sm w-full rounded-lg"
							onclick={connectConnector}
						>
							{m.market_connect()}
						</button>
					{:else}
						<div class="flex flex-col gap-2">
							<input
								type="text"
								class="input input-sm w-full rounded-lg border-base-300/70 bg-base-100"
								placeholder={m.market_request_reason_label()}
								bind:value={reasonText}
							/>
							<button
								type="button"
								class="btn btn-primary btn-sm w-full rounded-lg"
								disabled={submitting}
								onclick={submitRequest}
							>
								{m.market_request_connect()}
							</button>
						</div>
					{/if}

					{#if submitError}
						<p class="text-error text-sm">{submitError}</p>
					{/if}
				</div>
			{:else if selected.tab === 'skills'}
				<div class="divider"></div>
				<button
					type="button"
					class="btn btn-primary btn-sm w-full rounded-lg"
					onclick={openSkillDetail}
				>
					{m.market_use()}
				</button>
			{:else if selected.tab === 'experts'}
				<div class="divider"></div>
				<button
					type="button"
					class="btn btn-primary btn-sm w-full rounded-lg"
					onclick={openExpertDetail}
				>
					{m.market_connect()}
				</button>
			{/if}
		</div>
		<button type="button" class="modal-backdrop" aria-label={m.market_close()} onclick={closeDetail}
		></button>
	</div>
{/if}
