<script lang="ts">
	import { productTitle } from '$lib/branding.svelte';
	import TabLayout, { type TabView } from '$lib/components/TabLayout.svelte';
	import { m } from '$lib/i18n';
	import ApiKeysView from './ApiKeysView.svelte';
	import ConnectionView from './ConnectionView.svelte';
	import TablePermissionsView from './TablePermissionsView.svelte';
	import { loadSettings, type MetabaseSettings } from './metabase';

	let settings = $state<MetabaseSettings>(loadSettings());

	let views = $derived.by((): TabView[] => [
		{
			label: m.data_permissions_connection_tab(),
			value: 'connection',
			content: connectionView
		},
		{
			label: m.data_permissions_api_keys_tab(),
			value: 'api-keys',
			content: apiKeysView
		},
		{
			label: m.data_permissions_table_permissions_tab(),
			value: 'table-permissions',
			content: tablePermissionsView
		}
	]);
</script>

<svelte:head><title>{productTitle(m.data_permissions_title())}</title></svelte:head>

<TabLayout
	title={m.data_permissions_title()}
	defaultView="connection"
	{views}
	classes={{ childrenContainer: 'max-w-none' }}
/>

{#snippet connectionView()}
	<div class="p-4">
		<ConnectionView {settings} onsave={(next) => (settings = next)} />
	</div>
{/snippet}

{#snippet apiKeysView()}
	<div class="p-4"><ApiKeysView {settings} /></div>
{/snippet}

{#snippet tablePermissionsView()}
	<div class="p-4"><TablePermissionsView {settings} /></div>
{/snippet}
