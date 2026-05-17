<script lang="ts">
	import type { PageData } from './$types';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import CardGrid from '$lib/components/CardGrid.svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import { page } from '$app/stores';
	import { debouncedSearchQuery, isSearching } from '$lib/stores/searchQuery';
	import type { AnimeCardData } from '$lib/types';

	let { data }: { data: PageData } = $props();

	let searchResults = $state<AnimeCardData[]>([]);
	let searchLoading = $state(false);

	$effect(() => {
		const q = $debouncedSearchQuery;
		if (!q.trim()) {
			searchResults = [];
			return;
		}
		searchLoading = true;
		fetch(`/api/search?q=${encodeURIComponent(q)}&limit=100`)
			.then((r) => r.json())
			.then((j) => {
				searchResults = j.ok ? (j.data.hits as AnimeCardData[]) : [];
			})
			.catch(() => {
				searchResults = [];
			})
			.finally(() => {
				searchLoading = false;
			});
	});

	async function fetchPage(cursor: string) {
		const u = new URL($page.url);
		u.pathname = '/api/anime';
		u.searchParams.set('tab', 'world');
		u.searchParams.set('cursor', cursor);
		const r = await fetch(u);
		const j = await r.json();
		return j.ok ? j.data : { items: [] };
	}

	function noMore(): Promise<{ items: AnimeCardData[]; nextCursor?: string }> {
		return Promise.resolve({ items: [] });
	}
</script>

<div class="layout">
	<Sidebar tab="world" counts={data.counts} />
	<div class="content">
		<div class="toolbar">
			<FilterBar
				tab="world"
				availableTypes={data.facets.types}
				availableYears={data.facets.years}
				availableGenres={data.facets.genres}
				counts={data.counts}
			/>
		</div>
		{#if $isSearching}
			{#if searchLoading}
				<div class="search-status">Searching…</div>
			{:else if searchResults.length === 0}
				<div class="search-status">No results</div>
			{:else}
				<CardGrid initial={searchResults} initialCursor={undefined} fetchPage={noMore} />
			{/if}
		{:else}
			<!-- {#key} forces CardGrid to re-mount when the URL search changes
			     (sort / filter / year). The component holds local state for
			     loadMore() appends and would otherwise need a fragile $effect
			     to detect navigation. Re-mount is cleaner: scroll resets, the
			     IntersectionObserver re-subscribes, no stale-cursor races. -->
			{#key $page.url.search}
				<CardGrid initial={data.page.items} initialCursor={data.page.nextCursor} {fetchPage} />
			{/key}
		{/if}
	</div>
</div>

<style>
	.layout {
		display: flex;
		height: 100%;
	}
	.content {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.toolbar {
		display: flex;
		padding: 0;
		position: relative;
		flex-shrink: 0;
	}
	.toolbar > :global(*) {
		flex: 1;
		min-width: 0;
	}
	.search-status {
		padding: var(--space-8);
		text-align: center;
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
</style>
