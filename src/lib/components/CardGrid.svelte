<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import AnimeCard from './AnimeCard.svelte';
	import type { AnimeCardData } from '$lib/types';

	let {
		initial,
		initialCursor,
		fetchPage,
		selectMode = false,
		selectedAids,
		onSelectToggle
	}: {
		initial: AnimeCardData[];
		initialCursor: string | undefined;
		fetchPage: (cursor: string) => Promise<{ items: AnimeCardData[]; nextCursor?: string }>;
		selectMode?: boolean;
		selectedAids?: Set<number>;
		onSelectToggle?: (aid: number) => void;
	} = $props();

	// We hold `items` and `cursor` as local state so loadMore() can append
	// without round-tripping through the server load. The first-render-only
	// capture is exactly what we want here: navigation (sort / filter / year)
	// is handled by the PARENT wrapping us in {#key $page.url.search} so this
	// component re-mounts entirely. Trying to re-sync via $effect was fragile:
	// any parent reactivity that touched `initial` snapped state back to page 1
	// mid-scroll and could leave loadMore in a "loading-forever" loop.
	// svelte-ignore state_referenced_locally
	let items = $state<AnimeCardData[]>(initial);
	// svelte-ignore state_referenced_locally
	let cursor = $state<string | undefined>(initialCursor);
	let loading = $state(false);
	let sentinel = $state<HTMLElement | null>(null);
	let observer: IntersectionObserver | null = null;

	async function loadMore() {
		if (loading || !cursor) return;
		loading = true;
		try {
			const r = await fetchPage(cursor);
			items = items.concat(r.items);
			cursor = r.nextCursor;
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		observer = new IntersectionObserver(
			(entries) => {
				if (entries[0].isIntersecting) loadMore();
			},
			{ rootMargin: '300px' }
		);
		if (sentinel) observer.observe(sentinel);
	});
	onDestroy(() => observer?.disconnect());
</script>

<div class="grid">
	{#each items as card (card.aid)}
		<AnimeCard
			{card}
			{selectMode}
			selected={selectedAids?.has(card.aid) ?? false}
			{onSelectToggle}
		/>
	{/each}
</div>
<div bind:this={sentinel} class="sentinel">
	{#if loading}<span>Loading…</span>
	{:else if !cursor}<span class="muted">End of list</span>{/if}
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		grid-auto-rows: max-content;
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-4);
		overflow-y: auto;
		flex: 1;
		min-height: 0;
	}
	/* Tablet: smaller minmax for tighter packing */
	@media (max-width: 1024px) {
		.grid {
			grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		}
	}
	/* Mobile: 2 cards per row, smaller gaps + padding */
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
			gap: var(--space-2);
			padding: var(--space-2);
		}
	}
	.sentinel {
		padding: 1rem;
		text-align: center;
		color: var(--text-muted);
	}
	.muted {
		font-size: 0.8rem;
	}
</style>
