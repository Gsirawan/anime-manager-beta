<script lang="ts">
	import type { PageData } from './$types';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import CardGrid from '$lib/components/CardGrid.svelte';
	import FilterBar from '$lib/components/FilterBar.svelte';
	import BulkActionBar from '$lib/components/BulkActionBar.svelte';
	import { page } from '$app/stores';
	import { debouncedSearchQuery, isSearching } from '$lib/stores/searchQuery';
	import type { AnimeCardData, WatchStatus } from '$lib/types';

	let { data }: { data: PageData } = $props();

	let searchResults = $state<AnimeCardData[]>([]);
	let searchLoading = $state(false);

	// ── Bulk select state ──────────────────────────────────────────────
	let selectMode = $state(false);
	let selectedAids = $state<Set<number>>(new Set());
	let bulkBusy = $state(false);

	function toggleSelectMode() {
		selectMode = !selectMode;
		if (!selectMode) selectedAids = new Set();
	}

	function toggleCard(aid: number) {
		// Replace the Set so Svelte reactivity picks up the change.
		const next = new Set(selectedAids);
		if (next.has(aid)) next.delete(aid);
		else next.add(aid);
		selectedAids = next;
	}

	function clearSelection() {
		selectedAids = new Set();
	}

	async function postBulk(body: object): Promise<boolean> {
		const r = await fetch('/api/mylist/bulk', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		const j = await r.json();
		return !!j.ok;
	}

	async function bulkApply(status: WatchStatus) {
		if (selectedAids.size === 0) return;
		bulkBusy = true;
		try {
			const ok = await postBulk({
				aids: [...selectedAids],
				action: 'set_status',
				status
			});
			if (ok) {
				selectMode = false;
				selectedAids = new Set();
				// Reload to refresh facet counts + page data.
				location.reload();
			}
		} finally {
			bulkBusy = false;
		}
	}

	async function bulkRemove() {
		if (selectedAids.size === 0) return;
		if (!confirm(`Remove ${selectedAids.size} item(s) from your list?`)) return;
		bulkBusy = true;
		try {
			const ok = await postBulk({
				aids: [...selectedAids],
				action: 'remove'
			});
			if (ok) {
				selectMode = false;
				selectedAids = new Set();
				location.reload();
			}
		} finally {
			bulkBusy = false;
		}
	}

	function bulkExport() {
		if (selectedAids.size === 0) return;
		const text = [...selectedAids].join(',');
		void navigator.clipboard?.writeText(text);
	}

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
		u.searchParams.set('tab', 'my');
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
	<Sidebar tab="my" counts={data.counts} />
	<div class="content">
		<div class="toolbar">
			<FilterBar
				tab="my"
				availableTypes={data.facets.types}
				availableYears={data.facets.years}
				availableGenres={data.facets.genres}
				counts={data.counts}
				{selectMode}
				selectedCount={selectedAids.size}
				onToggleSelect={toggleSelectMode}
			/>
		</div>
		{#if $isSearching}
			{#if searchLoading}
				<div class="search-status">Searching…</div>
			{:else if searchResults.length === 0}
				<div class="search-status">No results</div>
			{:else}
				<CardGrid
					initial={searchResults}
					initialCursor={undefined}
					fetchPage={noMore}
					{selectMode}
					{selectedAids}
					onSelectToggle={toggleCard}
				/>
			{/if}
		{:else}
			<!-- {#key} forces CardGrid to re-mount when the URL search changes
			     (status / type / year). See world-anime/+page.svelte for the
			     full rationale. -->
			{#key $page.url.search}
				<CardGrid
					initial={data.page.items}
					initialCursor={data.page.nextCursor}
					{fetchPage}
					{selectMode}
					{selectedAids}
					onSelectToggle={toggleCard}
				/>
			{/key}
		{/if}
	</div>
</div>

{#if selectMode && selectedAids.size > 0}
	<BulkActionBar
		count={selectedAids.size}
		busy={bulkBusy}
		onApply={bulkApply}
		onRemove={bulkRemove}
		onExport={bulkExport}
		onClear={clearSelection}
	/>
{/if}

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
