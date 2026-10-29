<script lang="ts">
	import { page } from '$app/state';
	import { productTitle } from '$lib/branding.svelte';
	import type { DateRange } from '$lib/components/Calendar.svelte';
	import Layout from '$lib/components/Layout.svelte';
	import AuditLogCalendar from '$lib/components/admin/audit-logs/AuditLogCalendar.svelte';
	import AuditLogsPageContent from '$lib/components/admin/audit-logs/AuditLogsPageContent.svelte';
	import VirtualPageRoot from '$lib/components/ui/virtual-page/virtual-page-viewport.svelte';
	import { PAGE_TRANSITION_DURATION } from '$lib/constants';
	import { m } from '$lib/i18n';
	import { goto } from '$lib/url';
	import { Captions } from '@lucide/svelte';
	import { isValid, subDays } from 'date-fns';
	import type { Component } from 'svelte';
	import { fly } from 'svelte/transition';

	let { data } = $props();
	let { apiKey, apiKeyId } = $derived(data);
	let duration = PAGE_TRANSITION_DURATION;

	const scopeApiKeyId = $derived(apiKey?.id != null ? String(apiKey.id) : '');

	function parseDateParam(value: string | null): Date | undefined {
		if (!value) return undefined;
		const parsed = new Date(value);
		return isValid(parsed) ? parsed : undefined;
	}

	let endDate = $derived(parseDateParam(page.url.searchParams.get('end')) ?? new Date());
	let startDate = $derived(
		parseDateParam(page.url.searchParams.get('start')) ?? subDays(endDate, 7)
	);

	function handleDateRangeChange(range: DateRange) {
		const currentUrl = new URL(page.url);
		currentUrl.searchParams.set('start', range.start?.toISOString() ?? '');
		currentUrl.searchParams.set('end', range.end?.toISOString() ?? '');
		goto(currentUrl, { noScroll: true, keepFocus: true, replaceState: true });
	}
</script>

<Layout
	title={`${apiKey?.name || m.identity_access_agents_agent_identity()} | ${apiKeyId}`}
	showBackButton
	classes={{ childrenContainer: 'max-w-none', container: 'pb-0' }}
	main={{
		component: VirtualPageRoot as unknown as Component,
		props: { class: '', as: 'main', itemHeight: 56, overscan: 5 }
	}}
>
	{#snippet rightNavActions()}
		<AuditLogCalendar start={startDate} end={endDate} onChange={handleDateRangeChange} />
	{/snippet}
	<div
		class="flex h-full w-full flex-col gap-4 pb-8"
		in:fly={{ x: 100, duration }}
		out:fly={{ x: -100, duration }}
	>
		<AuditLogsPageContent apiKeyId={scopeApiKeyId || null} startTime={startDate} endTime={endDate}>
			{#snippet emptyContent()}
				<div class="flex w-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
					<Captions class="text-muted-content size-20 opacity-50" />
					<h4 class="text-muted-content text-lg font-semibold">
						{m.identity_access_agents_api_key_no_mcp_logs()}
					</h4>
					<p class="text-muted-content max-w-md text-sm font-light">
						{m.identity_access_agents_api_key_no_mcp_logs_description()}
					</p>
				</div>
			{/snippet}
		</AuditLogsPageContent>
	</div>
</Layout>

<svelte:head>
	<title
		>{productTitle(
			`${apiKey?.name || m.identity_access_agents_agent_identity()} | ${apiKeyId}`
		)}</title
	>
</svelte:head>
