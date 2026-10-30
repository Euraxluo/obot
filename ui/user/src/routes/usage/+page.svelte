<script lang="ts">
	import { productTitle } from '$lib/branding.svelte';
	import { m } from '$lib/i18n';
	import McpUsageView from './McpUsageView.svelte';
</script>

<svelte:head>
	<title>{productTitle(m.audit_usage_usage_title())}</title>
</svelte:head>

<div class="max-w-none pt-4 md:pl-8 mx-auto md:max-w-(--breakpoint-xl)">
	<McpUsageView />
</div>
