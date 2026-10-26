<script lang="ts">
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
	<span class="flex items-start gap-3">
		<span class="shrink-0">{@render icon()}</span>
		<span class="min-w-0 flex-1">
			<span class="block truncate text-sm font-semibold" {title}>{title}</span>
			<span
				class="text-muted-content mt-1 line-clamp-2 block text-sm font-light"
				title={description}
			>
				{description || '—'}
			</span>
		</span>
	</span>
	{#if tags && tags.length > 0}
		<span class="flex flex-wrap gap-1.5">
			{#each tags.slice(0, 4) as tag (tag)}
				<span class="bg-base-200/80 text-muted-content rounded-full px-2 py-0.5 text-xs">
					{tag}
				</span>
			{/each}
		</span>
	{/if}
	{#if status}
		<span class="mt-auto flex justify-end">
			<span
				class={twMerge(
					'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs',
					toneClasses[status.tone]
				)}
			>
				<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
				{status.label}
			</span>
		</span>
	{/if}
</button>
