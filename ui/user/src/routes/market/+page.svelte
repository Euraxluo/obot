<script lang="ts">
	import { productTitle } from '$lib/branding.svelte';
	import CopyField from '$lib/components/CopyField.svelte';
	import Search from '$lib/components/Search.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import TabLayout, { type TabView } from '$lib/components/TabLayout.svelte';
	import MarketplaceCard from '$lib/components/marketplace/MarketplaceCard.svelte';
	import MarketplaceGrid from '$lib/components/marketplace/MarketplaceGrid.svelte';
	import ConnectVMcp from '$lib/components/vmcps/ConnectVMcp.svelte';
	import McpServerIcon from '$lib/components/vmcps/McpServerIcon.svelte';
	import { sanitizeFilenameSegment, saveBlob } from '$lib/download';
	import { m } from '$lib/i18n';
	import { toHTMLFromMarkdownWithNewTabLinks } from '$lib/markdown';
	import { UserService, type ConnectorAccessRequest, type Skill } from '$lib/services';
	import { AiClient, COMMON_AI_CLIENTS_MAP } from '$lib/services/user/constants';
	import {
		catalogEntryToVMCPComponent,
		catalogEntryDisplayName,
		entryCategories,
		matchesQuery,
		sortMcpServers
	} from '$lib/services/vmcps/utils';
	import { mcpServersAndEntries, profile } from '$lib/stores';
	import { formatTimeAgo } from '$lib/time';
	import { goto } from '$lib/url';
	import { Bot, CircleAlert, Download, Lightbulb, SearchX } from '@lucide/svelte';
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { twMerge } from 'tailwind-merge';

	let { data } = $props();

	type Tab = 'skills' | 'connectors';

	type SelectedItem = {
		tab: Tab;
		id: string;
		title: string;
		description: string;
		iconURL?: string;
		tags: string[];
		href?: string;
		entryID?: string;
		skill?: Skill;
	};

	let query = $state('');
	let selected = $state<SelectedItem>();
	let requests = $state<ConnectorAccessRequest[]>([]);
	let reasonText = $state('');
	let submitting = $state(false);
	let submitError = $state('');
	let connecting = $state(false);
	let connectDialog = $state<ReturnType<typeof ConnectVMcp>>();

	onMount(() => {
		if (!mcpServersAndEntries.current.isInitialized) {
			mcpServersAndEntries.initialize({ scope: 'user' });
		}
	});

	// Keep the fetched request list in sync when returning from the connect flow.
	$effect(() => {
		requests = data.requests;
	});

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
		const byConnector = new SvelteMap<string, ConnectorAccessRequest>();
		for (const request of requests) {
			const existing = byConnector.get(request.manifest.connectorID);
			if (!existing || (request.created ?? '') > (existing.created ?? '')) {
				byConnector.set(request.manifest.connectorID, request);
			}
		}
		return byConnector;
	});

	let myRequests = $derived(
		[...requests].sort((left, right) => (right.created ?? '').localeCompare(left.created ?? ''))
	);

	/** Entry IDs the user already composed into a personal vMCP. */
	let connectedEntryIDs = $derived.by(() => {
		const connected = new SvelteSet<string>();
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

	function requestConnectorName(request: ConnectorAccessRequest) {
		const entry = allEntries.find((candidate) => candidate.id === request.manifest.connectorID);
		return (
			(entry ? catalogEntryDisplayName(entry) : '') ||
			request.manifest.connectorName ||
			request.manifest.connectorID
		);
	}

	function requestStatusLabel(status: ConnectorAccessRequest['manifest']['status']) {
		switch (status) {
			case 'pending':
				return m.market_request_pending();
			case 'approved':
				return m.market_request_approved();
			default:
				return m.market_rejected();
		}
	}

	function requestStatusClass(status: ConnectorAccessRequest['manifest']['status']) {
		switch (status) {
			case 'pending':
				return 'badge-warning';
			case 'approved':
				return 'badge-success';
			default:
				return 'badge-error';
		}
	}

	// --- Skills ---

	let visibleSkills = $derived(
		data.skills.filter(
			(skill) =>
				!query ||
				skillTitle(skill).toLowerCase().includes(query.toLowerCase()) ||
				(skill.description ?? '').toLowerCase().includes(query.toLowerCase())
		)
	);

	function skillTitle(skill: Skill) {
		const metadataName = skill.metadata?.displayNameZh;
		return (
			(typeof metadataName === 'string' ? metadataName.trim() : '') ||
			skill.displayName ||
			skill.name ||
			m.market_untitled_skill()
		);
	}

	function skillTags(skill: Skill) {
		if (!skill.repoURL) return [];
		try {
			return [new URL(skill.repoURL).hostname.replace(/^www\./, '')];
		} catch {
			return [skill.repoURL];
		}
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

	function openSkill(skill: Skill) {
		selected = {
			tab: 'skills',
			id: skill.id,
			title: skillTitle(skill),
			description: skill.description ?? '',
			tags: skill.repoURL ? [skill.repoURL] : [],
			skill
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

	async function connectConnector() {
		const entryID = selected?.entryID;
		const entry = entryID ? allEntries.find((item) => item.id === entryID) : undefined;
		if (!entry || connecting) return;

		connecting = true;
		submitError = '';
		try {
			const existing = data.vmcps.find(
				(vmcp) =>
					vmcp.userID === profile.current.id &&
					vmcp.components?.some((component) => component.mcpServerCatalogEntryID === entry.id)
			);
			const source =
				existing ??
				(await UserService.createVMCP({
					displayName: catalogEntryDisplayName(entry) || entry.id,
					description: entry.manifest.description || entry.manifest.shortDescription || '',
					toolSearch: false,
					components: [catalogEntryToVMCPComponent(entry)]
				}));
			// Re-read the reconciled vMCP so a connector that became ready after creation
			// immediately renders the harness instructions rather than a stale setup state.
			const target = await UserService.getVMCP(source.id);
			if (!existing) {
				data = { ...data, vmcps: [...data.vmcps, target] };
			}

			closeDetail();
			connectDialog?.open(target);
		} catch {
			submitError = m.market_connect_failed();
		} finally {
			connecting = false;
		}
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

	let selectedSkill = $derived.by(() => {
		const current = selected;
		if (!current || current.tab !== 'skills') return undefined;
		return current.skill ?? data.skills.find((s) => s.id === current.id);
	});

	let selectedSkillOsTab = $state<'macos/linux' | 'windows'>('macos/linux');
	let downloadingSkill = $state(false);

	let clientUnzipCommands = $derived.by(() => {
		const skillName = sanitizeFilenameSegment(
			selectedSkill?.name ?? selectedSkill?.id ?? 'skill'
		);
		const command = (clientSkillsDirectory: string) => {
			if (selectedSkillOsTab === 'windows') {
				const windowsSkillsDirectory = clientSkillsDirectory.replaceAll('/', '\\');
				return `Expand-Archive -LiteralPath "$env:USERPROFILE\\Downloads\\${skillName}.zip" -DestinationPath "$env:USERPROFILE\\${windowsSkillsDirectory}\\${skillName}" -Force`;
			}

			return `unzip "$HOME/Downloads/${skillName}.zip" -d "$HOME/${clientSkillsDirectory}/${skillName}"`;
		};

		return [
			{
				id: 'cursor',
				label: 'Cursor',
				icon: COMMON_AI_CLIENTS_MAP.get(AiClient.Cursor)?.icon,
				iconDark: COMMON_AI_CLIENTS_MAP.get(AiClient.Cursor)?.iconDark,
				command: command('.cursor/skills')
			},
			{
				id: 'claudeCode',
				label: 'Claude Code',
				icon: COMMON_AI_CLIENTS_MAP.get(AiClient.Claude)?.icon,
				iconDark: COMMON_AI_CLIENTS_MAP.get(AiClient.Claude)?.iconDark,
				command: command('.claude/skills')
			},
			{
				id: 'codex',
				label: 'Codex',
				icon: COMMON_AI_CLIENTS_MAP.get(AiClient.Codex)?.icon,
				iconDark: COMMON_AI_CLIENTS_MAP.get(AiClient.Codex)?.iconDark,
				command: command('.codex/skills')
			},
			{
				id: 'other',
				label: m.skills_other(),
				command: command('.agents/skills')
			}
		];
	});

	async function handleDownloadSkill(skill?: Skill) {
		if (!skill || downloadingSkill) return;
		downloadingSkill = true;
		try {
			const blob = await UserService.downloadSkill(skill.id);
			const filename = `${sanitizeFilenameSegment(skill.name ?? skill.id)}.zip`;
			saveBlob(blob, filename);
		} catch (err) {
			console.error('Failed to download skill', err);
		} finally {
			downloadingSkill = false;
		}
	}

	const views: TabView[] = [
		{ value: 'skills', label: m.market_tab_skills(), content: skillsView },
		{ value: 'connectors', label: m.market_tab_connectors(), content: connectorsView }
	];
</script>

<svelte:head>
	<title>{productTitle(m.market_title())}</title>
</svelte:head>

{#snippet skillsView()}
	<div class="bg-base-200/70 flex min-h-full flex-col gap-4 p-4 md:p-6">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div>
				<h2 class="text-xl font-semibold tracking-tight">{m.market_tab_skills()}</h2>
				<p class="text-muted-content mt-1 text-sm font-light">
					{m.market_skills_subtitle ? m.market_skills_subtitle() : '选择要使用的技能并直接运行。'}
				</p>
			</div>
			<div class="flex w-full max-w-xl items-center gap-2">
				<Search
					value={query}
					onChange={(val) => (query = val)}
					placeholder={m.market_search_skills()}
					class="h-11 rounded-lg border-base-300/70 bg-base-100 shadow-sm"
				/>
			</div>
		</div>

		{#if visibleSkills.length === 0}
			<div
				class="bg-base-100 dark:bg-base-200 text-muted-content flex flex-col items-center gap-3 rounded-xl p-12 text-center"
			>
				<SearchX class="size-10 opacity-50" />
				<p class="text-sm">{m.market_empty_skills()}</p>
			</div>
		{:else}
			<MarketplaceGrid>
				{#each visibleSkills as skill (skill.id)}
					<MarketplaceCard
						testId={`market-skill-${skill.id}`}
						title={skillTitle(skill)}
						description={skill.description ?? ''}
						actionLabel={m.market_use()}
						onAction={() => openSkill(skill)}
					>
						{#snippet icon()}
							<span
								class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-lg"
							>
								<Bot class="size-5" />
							</span>
						{/snippet}
						{#snippet metadata()}
							<span class="text-muted-content flex items-center gap-2 text-xs font-light">
								{#each skillTags(skill) as tag (tag)}
									<span>{tag}</span>
								{/each}
							</span>
						{/snippet}
					</MarketplaceCard>
				{/each}
			</MarketplaceGrid>
		{/if}
	</div>
{/snippet}

{#snippet connectorsView()}
	<div class="bg-base-200/70 flex min-h-full flex-col gap-4 p-4 md:p-6">
		<div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
			<div>
				<h2 class="text-xl font-semibold tracking-tight">{m.market_tab_connectors()}</h2>
				<p class="text-muted-content mt-1 text-sm font-light">
					浏览 {allEntries.length} 个可用连接器，并申请访问或连接。
				</p>
			</div>
			<div class="flex w-full max-w-xl items-center gap-2">
				<Search
					value={query}
					onChange={(val) => (query = val)}
					placeholder={m.market_search_connectors()}
					class="h-11 rounded-lg border-base-300/70 bg-base-100 shadow-sm"
				/>
			</div>
		</div>

		<section
			data-testid="market-my-requests"
			aria-label={m.market_my_requests()}
			class="bg-base-100 border-base-300 dark:bg-base-200 rounded-xl border p-4 shadow-sm"
		>
			<h2 class="text-sm font-semibold">{m.market_my_requests()}</h2>
			{#if myRequests.length === 0}
				<p class="text-muted-content mt-2 text-sm">
					{m.market_my_requests_empty()}
				</p>
			{:else}
				<ul class="mt-3 flex flex-col divide-y divide-base-200">
					{#each myRequests as request (request.id)}
						<li
							data-testid={`market-request-${request.id}`}
							class="flex flex-col gap-2 py-3 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
						>
							<div class="min-w-0">
								<p class="truncate text-sm font-medium">{requestConnectorName(request)}</p>
								<p class="text-muted-content truncate text-xs">
									{request.manifest.reason || m.market_request_no_reason()}
								</p>
							</div>
							<div class="flex shrink-0 items-center gap-3">
								<time
									class="text-muted-content text-xs"
									title={request.created ? formatTimeAgo(request.created).fullDate : undefined}
								>
									{#if request.created}
										{formatTimeAgo(request.created).relativeTime}
									{/if}
								</time>
								<span class="badge badge-sm {requestStatusClass(request.manifest.status)}">
									{requestStatusLabel(request.manifest.status)}
								</span>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		{#if mcpServersAndEntries.current.loading && allEntries.length === 0}
			<MarketplaceGrid>
				{#each Array.from({ length: 6 }) as _, index (index)}
					<Skeleton type="card" class="h-28 rounded-xl" />
				{/each}
			</MarketplaceGrid>
		{:else if visibleEntries.length === 0}
			<div
				class="bg-base-100 dark:bg-base-200 text-muted-content flex flex-col items-center gap-3 rounded-xl p-12 text-center"
			>
				<SearchX class="size-10 opacity-50" />
				<p class="text-sm">{m.market_empty_connectors()}</p>
			</div>
		{:else}
			<MarketplaceGrid>
				{#each visibleEntries as entry (entry.id)}
					<MarketplaceCard
						testId={`market-connector-${entry.id}`}
						title={catalogEntryDisplayName(entry) || m.market_untitled_connector()}
						description={entry.manifest.shortDescription || entry.manifest.description || ''}
						actionLabel={m.market_connect()}
						onAction={() => openConnector(entry.id)}
					>
						{#snippet icon()}
							<McpServerIcon
								icon={entry.manifest.icon}
								width={40}
								height={40}
								classes={{ root: 'size-10 bg-primary/12 rounded-lg' }}
								class="size-5"
							/>
						{/snippet}
						{#snippet metadata()}
							<span class="text-muted-content flex items-center gap-2 text-xs font-light">
								<span>{connectorStatus(entry.id).label}</span>
								{#if entryCategories(entry).length}
									<span aria-hidden="true">·</span>
									<span>{entryCategories(entry).join(', ')}</span>
								{/if}
							</span>
						{/snippet}
					</MarketplaceCard>
				{/each}
			</MarketplaceGrid>
		{/if}
	</div>
{/snippet}

<TabLayout
	title={m.market_title()}
	{views}
	defaultView="skills"
	classes={{
		container: 'justify-start md:pt-0',
		childrenContainer: 'pt-0'
	}}
/>

{#if selected}
	<div class="modal modal-open" role="dialog" aria-modal="true" aria-label={selected.title}>
		<div class="modal-box bg-base-100 dark:bg-base-200 max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl">
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
							<Bot class="size-5" />
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
							disabled={connecting}
							onclick={() => void connectConnector()}
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
			{:else if selected.tab === 'skills' && selectedSkill}
				<div class="divider my-4">{m.market_skill_usage_title()}</div>

				<div class="flex flex-col gap-4">
					<!-- Step 1: Download zip -->
					<div class="bg-base-200/50 dark:bg-base-300/40 rounded-xl p-3.5">
						<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
							<div>
								<p class="text-xs font-semibold text-base-content">
									{m.skills_install_step_download({
										name: selectedSkill.displayName || selectedSkill.name || ''
									})}
								</p>
								<p class="text-xs text-muted-content mt-0.5">
									下载技能包压缩文件（{sanitizeFilenameSegment(selectedSkill.name ?? selectedSkill.id)}.zip）
								</p>
							</div>
							<button
								type="button"
								class="btn btn-primary btn-sm shrink-0 gap-2 rounded-lg"
								disabled={downloadingSkill}
								onclick={() => handleDownloadSkill(selectedSkill)}
							>
								<Download class="size-4" />
								{downloadingSkill ? '下载中...' : m.skills_download()}
							</button>
						</div>
					</div>

					<!-- Step 2: Unzip to Client -->
					<div class="flex flex-col gap-2.5">
						<div class="flex items-center justify-between">
							<p class="text-xs font-semibold text-base-content">
								{m.skills_install_step_unzip()}
							</p>
							<div role="tablist" class="tabs tabs-box tabs-xs">
								<button
									type="button"
									role="tab"
									class={twMerge('tab text-xs', selectedSkillOsTab === 'macos/linux' && 'tab-active')}
									onclick={() => (selectedSkillOsTab = 'macos/linux')}
									aria-selected={selectedSkillOsTab === 'macos/linux'}
								>
									macOS/Linux
								</button>
								<button
									type="button"
									role="tab"
									class={twMerge('tab text-xs', selectedSkillOsTab === 'windows' && 'tab-active')}
									onclick={() => (selectedSkillOsTab = 'windows')}
									aria-selected={selectedSkillOsTab === 'windows'}
								>
									Windows
								</button>
							</div>
						</div>
						<div class="flex flex-col gap-2">
							{#each clientUnzipCommands as client (client.id)}
								<CopyField
									value={client.command}
									id={`command-${client.id}`}
									classes={{
										inputLabel: 'bg-base-200/60 dark:bg-base-300',
										input: 'font-mono text-xs'
									}}
								>
									{#snippet preContent()}
										<span
											class="label shrink-0 w-32 mr-0 text-xs text-base-content flex items-center gap-1.5 font-medium"
										>
											{#if client.icon || client.iconDark}
												<img
													src={client.iconDark ?? client.icon}
													alt={m.skills_branding_icon_alt({ client: client.label })}
													class="size-4 dark:block hidden"
												/>
												<img
													src={client?.icon}
													alt={m.skills_branding_icon_alt({ client: client.label })}
													class="size-4 block dark:hidden"
												/>
											{:else}
												<Bot class="size-4" />
											{/if}
											{client.label}
										</span>
									{/snippet}
								</CopyField>
							{/each}
						</div>
					</div>

					<!-- Step 3: Run / Use in Chat -->
					<div class="rounded-xl border border-primary/20 bg-primary/5 p-3.5">
						<p class="text-xs font-semibold text-primary">
							{m.market_skill_step_call()}
						</p>
						<p class="mt-1 text-xs text-muted-content leading-relaxed">
							{m.market_skill_call_hint({
								name: sanitizeFilenameSegment(selectedSkill.name ?? selectedSkill.id)
							})}
						</p>
					</div>
				</div>
			{/if}
		</div>
		<button type="button" class="modal-backdrop" aria-label={m.market_close()} onclick={closeDetail}
		></button>
	</div>
{/if}

<ConnectVMcp bind:this={connectDialog} />
