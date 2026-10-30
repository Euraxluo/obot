<script lang="ts">
	import { tooltip } from '$lib/actions/tooltip.svelte';
	import { m } from '$lib/i18n';
	import type { BaseProvider } from '$lib/services/admin/types';
	import { darkMode } from '$lib/stores';
	import DotDotDot from '../DotDotDot.svelte';
	import { CircleCheck, CircleSlash, TriangleAlert } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		provider: BaseProvider;
		onConfigure: () => void;
		// Omitted when the provider cannot be deconfigured, so the menu is not offered at all.
		onDeconfigure?: () => void;
		configuredActions?: Snippet<[BaseProvider]>;
		readonly?: boolean;
		disableConfigure?: boolean;
		// Shown as a tooltip when disableConfigure hides the reason the button cannot be used.
		disableConfigureReason?: string;
		// Settings saved as a replacement while another provider still serves logins.
		staged?: boolean;
	}

	const {
		provider,
		onConfigure,
		onDeconfigure,
		configuredActions,
		readonly,
		disableConfigure,
		disableConfigureReason,
		staged
	}: Props = $props();
</script>

<div
	class={twMerge(
		'dark:bg-base-200 dark:border-base-400 bg-base-100 flex w-full flex-col items-center justify-center gap-4 rounded-lg border border-transparent p-4 pt-2 shadow-sm'
	)}
>
	<div class="flex min-h-9 w-full items-center justify-end">
		<div class="flex translate-x-2 items-center gap-1">
			{#if provider.configured}
				{#if configuredActions}
					{@render configuredActions(provider)}
				{/if}
				{#if onDeconfigure}
					<DotDotDot>
						<button
							disabled={readonly}
							class="menu-button text-error"
							onclick={() => onDeconfigure()}
						>
							{m.identity_access_provider_deconfigure_provider()}
						</button>
					</DotDotDot>
				{/if}
			{/if}
		</div>
	</div>

	{#if darkMode.isDark}
		{@const url = provider.iconDark ?? provider.icon}
		<img
			src={url}
			alt={provider.name}
			class={twMerge('size-16 rounded-md p-1', !provider.iconDark && 'bg-base-400')}
		/>
	{:else}
		<img src={provider.icon} alt={provider.name} class="size-16 rounded-md p-1" />
	{/if}

	<h4 class="text-center text-lg font-semibold">{provider.name}</h4>
	<div
		class={twMerge(
			'border-base-400 rounded-md border px-2 py-1',
			staged && !provider.configured && 'border-warning/40 bg-warning/10 text-warning'
		)}
	>
		<span class="flex items-center gap-1.5 text-xs font-light">
			{#if provider.configured}
				<CircleCheck class="size-4 text-success" />
				{m.core_status_configured()}
			{:else if staged}
				<TriangleAlert class="size-4 text-warning" />
				{m.identity_access_provider_staged()}
			{:else}
				<CircleSlash class="size-4 text-error" />
				{m.core_mcp_value_not_configured()}
			{/if}
		</span>
	</div>

	<div class="mt-auto w-full">
		<div
			class="w-full"
			use:tooltip={disableConfigure && disableConfigureReason
				? { classes: ['w-fit'], text: disableConfigureReason }
				: undefined}
		>
			<button
				onclick={onConfigure}
				class={twMerge(
					'w-full border-0 text-sm btn',
					provider.configured || staged ? 'btn-secondary' : 'btn-primary'
				)}
				disabled={disableConfigure}
			>
				{#if readonly}
					{m.identity_access_provider_view()}
				{:else if provider.configured}
					{m.identity_access_provider_modify()}
				{:else if staged}
					{m.identity_access_provider_resume_switch()}
				{:else}
					{m.identity_access_provider_configure()}
				{/if}
			</button>
		</div>
	</div>
</div>
