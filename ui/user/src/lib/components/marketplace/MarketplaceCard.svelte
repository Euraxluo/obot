<script lang="ts">
	import { resolve } from '$app/paths';
	import { Plus } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		title: string;
		description?: string;
		testId?: string;
		actionLabel: string;
		icon: Snippet;
		metadata?: Snippet;
		onAction?: (event: MouseEvent) => void;
		href?: `/${string}`;
		disabled?: boolean;
	}

	let {
		title,
		description,
		testId,
		actionLabel,
		icon,
		metadata,
		onAction,
		href,
		disabled = false
	}: Props = $props();

	let rootClass =
		'group bg-base-100 dark:bg-base-200 border-base-300/80 hover:border-primary/40 flex h-full min-h-28 items-center gap-3 rounded-xl border p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
</script>

{#if href && !disabled}
	<a href={resolve(href)} data-testid={testId} class={rootClass}>
		{@render icon()}
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-semibold" {title}>{title}</span>
			<span class="text-muted-content mt-1 block truncate text-sm font-light" title={description}>
				{description || '—'}
			</span>
			{#if metadata}
				<span class="mt-2 block">{@render metadata()}</span>
			{/if}
		</span>
		<span
			class="bg-base-200/80 text-muted-content group-hover:bg-primary group-hover:text-primary-content flex size-7 shrink-0 items-center justify-center rounded-full border border-transparent transition-all group-hover:border-primary"
			aria-hidden="true"
		>
			<Plus class="size-4" />
		</span>
		<span class="sr-only">{actionLabel}</span>
	</a>
{:else}
	<button
		type="button"
		{disabled}
		data-testid={testId}
		class={twMerge(
			rootClass,
			disabled && 'cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-none'
		)}
		onclick={onAction}
	>
		{@render icon()}
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-semibold" {title}>{title}</span>
			<span class="text-muted-content mt-1 block truncate text-sm font-light" title={description}>
				{description || '—'}
			</span>
			{#if metadata}
				<span class="mt-2 block">{@render metadata()}</span>
			{/if}
		</span>
		<span
			class="bg-base-200/80 text-muted-content group-hover:bg-primary group-hover:text-primary-content flex size-7 shrink-0 items-center justify-center rounded-full border border-transparent transition-all group-hover:border-primary"
			aria-hidden="true"
		>
			<Plus class="size-4" />
		</span>
	</button>
{/if}
