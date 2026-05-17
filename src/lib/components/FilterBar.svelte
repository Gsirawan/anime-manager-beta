<script lang="ts">
	import { page } from '$app/stores';
	import type { TypeCount, RatingBucketCounts } from '$lib/server/db/queries/facets';

	let {
		tab,
		availableTypes,
		availableYears,
		availableGenres,
		counts,
		selectMode = false,
		selectedCount = 0,
		onToggleSelect
	}: {
		tab: 'my' | 'world';
		availableTypes: string[];
		availableYears: number[];
		availableGenres: string[];
		counts?: { type: TypeCount[]; rating: RatingBucketCounts; status?: unknown };
		selectMode?: boolean;
		selectedCount?: number;
		onToggleSelect?: () => void;
	} = $props();

	function setParam(key: string, value: string | null) {
		const u = new URL($page.url);
		const current = u.searchParams.get(key);
		if (current === value || value === null) {
			u.searchParams.delete(key);
		} else {
			u.searchParams.set(key, value);
		}
		u.searchParams.delete('cursor');
		location.assign(u);
	}

	function isActive(key: string, value: string): boolean {
		return $page.url.searchParams.get(key) === value;
	}

	function clearAll() {
		const u = new URL($page.url);
		for (const k of ['type', 'year', 'season', 'genre', 'rating_min', 'status'])
			u.searchParams.delete(k);
		location.assign(u);
	}

	// Build type list from counts if available, else fall back to availableTypes
	const typeList = $derived(
		counts?.type.length ? counts.type : availableTypes.map((t) => ({ type: t, count: 0 }))
	);

	const ratingBuckets: { label: string; value: string; key: keyof RatingBucketCounts }[] = [
		{ label: 'Any', value: '', key: 'any' },
		{ label: '8+', value: '8', key: '8+' },
		{ label: '7+', value: '7', key: '7+' },
		{ label: '6+', value: '6', key: '6+' }
	];
</script>

<div class="filterbar">
	<!-- Type chips -->
	<div class="chip-group" role="group" aria-label="Filter by type">
		{#each typeList as t}
			<button
				class="chip"
				class:active={isActive('type', t.type)}
				onclick={() => setParam('type', t.type)}
			>
				{t.type}
				{#if t.count > 0}<span class="count">({t.count})</span>{/if}
			</button>
		{/each}
	</div>

	<!-- Rating chips -->
	<div class="chip-group" role="group" aria-label="Filter by rating">
		{#each ratingBuckets as b}
			<button
				class="chip"
				class:active={b.value === ''
					? !$page.url.searchParams.has('rating_min')
					: isActive('rating_min', b.value)}
				onclick={() => setParam('rating_min', b.value || null)}
			>
				{b.label}
				{#if counts?.rating && b.key !== 'any'}
					<span class="count">({counts.rating[b.key]})</span>
				{/if}
			</button>
		{/each}
	</div>

	<div class="spacer"></div>

	<!-- Clear button (only show when filters active) -->
	{#if [...$page.url.searchParams.keys()].some( (k) => ['type', 'year', 'rating_min', 'status', 'genre'].includes(k) )}
		<button class="clear-btn" onclick={clearAll} title="Clear all filters">✕</button>
	{/if}

	<!-- Select toggle (only rendered if parent wires it; My Anime only) -->
	{#if onToggleSelect}
		<button
			class="select-toggle"
			class:active={selectMode}
			onclick={onToggleSelect}
			aria-pressed={selectMode}
		>
			{selectMode ? 'Done' : 'Select'}
			{#if selectMode && selectedCount > 0}<span class="select-badge">{selectedCount}</span>{/if}
		</button>
	{/if}
</div>

<style>
	.filterbar {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--border);
		background: var(--surface);
		flex-wrap: wrap;
		min-height: 44px;
	}

	.chip-group {
		display: flex;
		gap: var(--space-1);
		flex-wrap: wrap;
	}

	.spacer {
		flex: 1;
	}

	.clear-btn {
		background: transparent;
		color: var(--text-dim);
		border: 1px solid var(--border);
		width: 26px;
		height: 26px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-xs);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}
	.clear-btn:hover {
		color: var(--error);
		border-color: var(--error);
	}

	.select-toggle {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		transition:
			background var(--t-fast),
			border-color var(--t-fast),
			color var(--t-fast);
	}
	.select-toggle:hover {
		border-color: var(--accent);
	}
	.select-toggle.active {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}
	.select-badge {
		background: rgba(0, 0, 0, 0.25);
		color: white;
		padding: 0 var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		font-weight: 700;
		min-width: 20px;
		text-align: center;
	}

	/* Mobile: tighter padding, smaller chips */
	@media (max-width: 640px) {
		.filterbar {
			padding: var(--space-2);
			gap: var(--space-1);
		}
		.spacer {
			display: none; /* wrap rather than push sort to its own corner */
		}
	}
</style>
