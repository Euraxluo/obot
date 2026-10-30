<script lang="ts">
	import { stripMarkdownToText } from '$lib/markdown';
	import type { Snippet } from 'svelte';
	import { twMerge } from 'tailwind-merge';

	interface Props {
		title: string;
		description?: string;
		testId?: string;
		icon: Snippet;
		tags?: string[];
		status?: { label: string; tone: 'neutral' | 'success' | 'warning' | 'error' };
		onSelect: () => void;
	}

	let { title, description, testId, icon, tags, status, onSelect }: Props = $props();

	let primaryTag = $derived(tags?.find(Boolean));
	let remainingTags = $derived(tags?.filter((tag) => tag !== primaryTag).slice(0, 3) ?? []);
	let descriptionText = $derived(stripMarkdownToText(description ?? '') || '—');

	const toneClasses: Record<NonNullable<Props['status']>['tone'], string> = {
		neutral: 'bg-base-200/80 text-muted-content',
		success: 'bg-primary/10 text-primary',
		warning: 'bg-warning/15 text-warning',
		error: 'bg-error/10 text-error'
	};
</script>

<button
	type="button"
	data-testid={testId}
	class="group bg-base-100 dark:bg-base-200 border-base-300/80 hover:border-primary/40 flex h-full min-h-32 flex-col gap-3 rounded-xl border p-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(15,23,42,0.08)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
	onclick={onSelect}
>
	<span class="flex min-w-0 items-center gap-2.5">
		<span class="shrink-0">{@render icon()}</span>
		<span class="min-w-0 flex-1 truncate text-sm font-semibold" {title}>{title}</span>
		{#if primaryTag}
			<span
				class="badge badge-ghost badge-sm max-w-24 shrink-0 truncate font-normal"
				title={primaryTag}
			>
				{primaryTag}
			</span>
		{/if}
	</span>

	<span
		class="text-muted-content line-clamp-3 block min-h-10 text-[13px] leading-5 font-light break-words"
		title={descriptionText}
	>
		{descriptionText}
	</span>

	{#if remainingTags.length > 0 || status}
		<span class="mt-auto flex min-h-6 flex-wrap items-center gap-1.5">
			{#each remainingTags as tag (tag)}
				<span
					class="border-base-300 text-muted-content max-w-24 truncate rounded-full border px-2 py-0.5 text-[11px]"
					title={tag}
				>
					{tag}
				</span>
			{/each}
			{#if status}
				<span
					class={twMerge(
						'ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px]',
						toneClasses[status.tone]
					)}
				>
					<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
					{status.label}
				</span>
			{/if}
		</span>
	{/if}
</button>
