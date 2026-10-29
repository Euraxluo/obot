<script lang="ts">
	import { productTitle } from '$lib/branding.svelte';
	import TabLayout from '$lib/components/TabLayout.svelte';
	import { m } from '$lib/i18n';
	import type { GitCredential, ImagePullSecret, ImagePullSecretCapability } from '$lib/services';
	import { profile, version } from '$lib/stores';
	import { defaultAppNotification } from '$lib/stores/appNotification.svelte';
	import { compileAppPreferences } from '$lib/stores/appPreferences.svelte';
	import BrandingConfigurationSidebar from './BrandingConfigurationSidebar.svelte';
	import BrandingView from './BrandingView.svelte';
	import McpConfigView from './McpConfigView.svelte';
	import SettingsView from './SettingsView.svelte';
	import { untrack } from 'svelte';

	let { data } = $props();
	let capability = $state<ImagePullSecretCapability>(
		untrack(() => data.capability ?? { available: false })
	);
	let imagePullSecrets = $state<ImagePullSecret[]>(untrack(() => data.imagePullSecrets ?? []));
	let credentials = $state<GitCredential[]>(untrack(() => data.gitCredentials ?? []));
	let brandingPreferences = $derived(data.appPreferences ?? compileAppPreferences());
	let showRegistryConnections = $derived(version.current.engine === 'kubernetes');

	let views = $derived([
		{ label: m.platform_settings_tab(), value: 'settings', content: settings },
		...(version.current.engine === 'kubernetes' && !version.current.hideK8sDetails
			? [
					{
						label: m.platform_mcp_config_tab(),
						value: 'mcp-config',
						content: mcpConfig
					}
				]
			: []),
		{ label: m.platform_branding_tab(), value: 'branding', content: branding }
	]);

	$effect(() => {
		capability = data.capability ?? { available: false };
		imagePullSecrets = data.imagePullSecrets ?? [];
	});

	$effect(() => {
		credentials = data.gitCredentials ?? [];
	});
</script>

<svelte:head>
	<title>{productTitle(m.platform_title())}</title>
</svelte:head>

<TabLayout
	title={m.platform_title()}
	defaultView="settings"
	classes={{ container: 'pb-0', childrenContainer: 'max-w-none' }}
	rightSidebar={viewSidebar}
	{views}
/>

{#snippet viewSidebar(view: string)}
	{#if view === 'branding'}
		<BrandingConfigurationSidebar initialAppPreferences={brandingPreferences} />
	{/if}
{/snippet}

{#snippet branding()}
	<BrandingView />
{/snippet}

{#snippet mcpConfig()}
	<McpConfigView k8sSettings={data.k8sSettings} />
{/snippet}

{#snippet settings()}
	<SettingsView
		appNotification={data.appNotification ?? defaultAppNotification}
		modelProxySettings={data.modelProxySettings}
		modelProxyUsage={data.modelProxyUsage}
		{showRegistryConnections}
		bind:capability
		bind:imagePullSecrets
		bind:gitCredentials={credentials}
	/>
{/snippet}
