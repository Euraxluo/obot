<script lang="ts">
	import { page } from '$app/state';
	import Search from '$lib/components/Search.svelte';
	import Skeleton from '$lib/components/Skeleton.svelte';
	import McpDeprecatedNotice from '$lib/components/mcp/McpDeprecatedNotice.svelte';
	import McpServerIcon from '$lib/components/vmcps/McpServerIcon.svelte';
	import { m } from '$lib/i18n';
	import { type MCPCatalogEntry } from '$lib/services';
	import { isDeprecatedMCPServer } from '$lib/services/user/mcp';
	import {
		catalogConfigurationFields,
		entryCategories,
		matchesQuery,
		sortMcpServers
	} from '$lib/services/vmcps/utils';
	import { mcpServersAndEntries } from '$lib/stores';
	import { setUrlParamAndUpdateUrl } from '$lib/url';
	import { ArrowRight, PackageSearch, Server } from '@lucide/svelte';
	import { fly } from 'svelte/transition';

	interface Props {
		query?: string;
		onQueryChange?: (value: string) => void;
	}

	let { query = '', onQueryChange }: Props = $props();

	let selectedEntry = $state<MCPCatalogEntry>();

	let allEntries = $derived(
		mcpServersAndEntries.current.entries.filter((entry) => entry.manifest.runtime !== 'vmcp')
	);
	let visibleEntries = $derived(
		sortMcpServers(
			allEntries.filter((entry) => !query || matchesQuery(entry, query)),
			'popularity',
			query
		)
	);
	let isLoading = $derived(
		mcpServersAndEntries.current.loading && mcpServersAndEntries.current.entries.length === 0
	);

	function updateQuery(value: string) {
		if (onQueryChange) {
			onQueryChange(value);
			return;
		}
		setUrlParamAndUpdateUrl(page.url, 'query', value);
	}

	function openDetails(entry: MCPCatalogEntry) {
		selectedEntry = entry;
	}

	function closeDetails() {
		selectedEntry = undefined;
	}

	function useInVMcp(entry: MCPCatalogEntry) {
		const params = new URLSearchParams({ new: 'true', entry: entry.id });
		setUrlParamAndUpdateUrl(page.url, 'query', null);
		page.url.pathname = '/vmcps';
		// Keep the connector in the URL while the vMCP designer initializes.
		page.url.search = `?${params.toString()}`;
		history.pushState({}, '', page.url);
		dispatchEvent(new PopStateEvent('popstate', { state: {} }));
	}

	function configurationSummary(entry: MCPCatalogEntry) {
		const fields = catalogConfigurationFields(entry);
		const required = fields.filter((field) => field.required);
		return { total: fields.length, required: required.length };
	}

	function runtimeLabel(entry: MCPCatalogEntry) {
		return entry.manifest.runtime === 'remote'
			? m.connectors_marketplace_runtime_remote()
			: m.connectors_marketplace_runtime_hosted();
	}
</script>

<div class="flex min-h-full flex-col gap-5">
	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
		<div class="space-y-2">
			<h2 class="text-2xl font-semibold tracking-tight">{m.connectors_marketplace_title()}</h2>
			<p class="text-muted-content text-sm font-light">
				{m.connectors_marketplace_subtitle({ count: allEntries.length })}
			</p>
		</div>
		<Search
			value={query}
			onChange={updateQuery}
			placeholder={m.connectors_marketplace_search()}
			class="border border-base-300 bg-base-100 shadow-sm"
		/>
	</div>

	{#if selectedEntry}
		{@const summary = configurationSummary(selectedEntry)}
		<section
			class="bg-base-100 dark:bg-base-200 border-base-300 rounded-xl border p-5 shadow-sm"
			transition:fly={{ y: 8, duration: 160 }}
		>
			<div class="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
				<div class="flex min-w-0 flex-col gap-4">
					<div class="flex min-w-0 items-start gap-4">
						<McpServerIcon
							icon={selectedEntry.manifest.icon}
							classes={{ root: 'size-14 items-center justify-center' }}
							class="size-7"
						/>
						<div class="min-w-0">
							<div class="flex flex-wrap items-center gap-2">
								<h3 class="truncate text-xl font-semibold">
									{selectedEntry.manifest.name ?? selectedEntry.id}
								</h3>
								<span class="badge badge-primary badge-sm">{runtimeLabel(selectedEntry)}</span>
								<span class="badge badge-ghost badge-sm">{selectedEntry.manifest.runtime}</span>
							</div>
							<p class="text-muted-content mt-2 text-sm leading-6 font-light">
								{selectedEntry.manifest.description ??
									selectedEntry.manifest.shortDescription ??
									m.connectors_marketplace_no_description()}
							</p>
						</div>
					</div>

					<dl class="grid gap-3 text-sm sm:grid-cols-3">
						<div>
							<dt class="text-muted-content text-xs uppercase">{m.core_type()}</dt>
							<dd class="mt-1 font-medium">{runtimeLabel(selectedEntry)}</dd>
						</div>
						<div>
							<dt class="text-muted-content text-xs uppercase">
								{m.connectors_marketplace_configuration()}
							</dt>
							<dd class="mt-1 font-medium">
								{summary.required}/{summary.total}
							</dd>
						</div>
						<div>
							<dt class="text-muted-content text-xs uppercase">
								{m.connectors_marketplace_categories()}
							</dt>
							<dd class="mt-1 font-medium">
								{entryCategories(selectedEntry).join(', ') ||
									m.connectors_marketplace_no_categories()}
							</dd>
						</div>
					</dl>

					<McpDeprecatedNotice deprecated={isDeprecatedMCPServer(selectedEntry)} />

					{#if catalogConfigurationFields(selectedEntry).length}
						<div class="border-base-300 dark:border-base-100 rounded-lg border p-4">
							<h4 class="text-sm font-semibold">{m.connectors_marketplace_config_summary()}</h4>
							<ul class="mt-3 grid gap-2 md:grid-cols-2">
								{#each catalogConfigurationFields(selectedEntry).slice(0, 6) as field (field.key)}
									<li class="flex items-start gap-2 text-sm">
										<span
											class="bg-primary/10 text-primary mt-0.5 rounded px-1.5 py-0.5 font-mono text-xs"
										>
											{field.key}
										</span>
										<span class="text-muted-content min-w-0 font-light">
											{field.name || field.description}
											{#if field.required}
												<span class="text-primary">*</span>
											{/if}
										</span>
									</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>

				<div class="flex shrink-0 flex-col gap-2 lg:w-48">
					<button class="btn btn-primary" onclick={() => useInVMcp(selectedEntry!)}>
						{m.connectors_marketplace_use_in_vmcp()}
						<ArrowRight class="size-4" />
					</button>
					<a class="btn btn-secondary" href={`/mcp-servers/c/${selectedEntry.id}?from=connectors`}>
						{m.connectors_marketplace_open_details()}
					</a>
					<button class="btn btn-ghost" onclick={closeDetails}>
						{m.core_close()}
					</button>
				</div>
			</div>
		</section>
	{/if}

	{#if isLoading}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{#each Array.from({ length: 8 }) as _, index (index)}
				<Skeleton type="card" class="h-44 rounded-xl" />
			{/each}
		</div>
	{:else if visibleEntries.length === 0}
		<div class="bg-base-100 dark:bg-base-200 my-16 flex flex-col items-center gap-4 rounded-xl p-8">
			<PackageSearch class="text-muted-content size-16 opacity-40" />
			<h3 class="text-muted-content text-lg font-semibold">
				{m.connectors_marketplace_empty_title()}
			</h3>
			<p class="text-muted-content text-sm font-light">
				{m.connectors_marketplace_empty_description({ query })}
			</p>
		</div>
	{:else}
		<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
			{#each visibleEntries as entry (entry.id)}
				{@const summary = configurationSummary(entry)}
				<button
					type="button"
					data-testid="connector-card-{entry.id}"
					class="bg-base-100 dark:bg-base-200 border-base-300 hover:border-primary/50 dark:hover:border-primary/50 group flex h-full min-h-44 flex-col gap-4 rounded-xl border p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:ring-primary"
					onclick={() => openDetails(entry)}
				>
					<div class="flex items-start justify-between gap-3">
						<div class="flex min-w-0 items-center gap-3">
							<McpServerIcon icon={entry.manifest.icon} class="size-5" />
							<h3 class="min-w-0 truncate font-semibold">
								{entry.manifest.name ?? entry.id}
							</h3>
						</div>
						<span class="badge badge-ghost badge-sm shrink-0">{entry.manifest.runtime}</span>
					</div>
					<p class="text-muted-content line-clamp-3 min-h-12 text-sm leading-5 font-light">
						{entry.manifest.shortDescription ??
							entry.manifest.description ??
							m.connectors_marketplace_no_description()}
					</p>
					<div class="mt-auto flex items-center justify-between gap-2 text-xs">
						<span class="text-muted-content">
							{summary.required}/{summary.total}
							{m.connectors_marketplace_config_short()}
						</span>
						<span class="text-primary flex items-center gap-1 opacity-70 group-hover:opacity-100">
							{m.connectors_marketplace_view()}
							<ArrowRight class="size-3.5" />
						</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if mcpServersAndEntries.current.entries.length === 0 && mcpServersAndEntries.current.isInitialized}
	<div class="bg-base-100 dark:bg-base-200 mt-10 flex flex-col items-center gap-4 rounded-xl p-10">
		<Server class="text-muted-content size-20 opacity-30" />
		<h3 class="text-muted-content text-lg font-semibold">
			{m.connectors_marketplace_catalog_empty_title()}
		</h3>
		<p class="text-muted-content max-w-xl text-center text-sm font-light">
			{m.connectors_marketplace_catalog_empty_description()}
		</p>
	</div>
{/if}
