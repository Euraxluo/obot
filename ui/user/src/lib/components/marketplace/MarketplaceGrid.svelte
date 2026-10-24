<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
	}

	let { children }: Props = $props();
</script>

<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
	{@render children()}
</div>
