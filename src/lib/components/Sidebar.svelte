<script lang="ts">
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import type {
		StatusCounts,
		YearCount,
		TypeCount,
		RatingBucketCounts
	} from '$lib/server/db/queries/facets';

	let {
		tab,
		counts
	}: {
		tab: 'my' | 'world';
		counts?: {
			status?: StatusCounts;
			year: YearCount[];
			/** Non-tombstoned anime with NULL year — rendered as an informational
			 * "Unknown (N)" row so the year sidebar sum reconciles with type sum.
			 * Optional for backwards compat; treated as 0 when absent. */
			yearUnknown?: number;
			type: TypeCount[];
			rating: RatingBucketCounts;
		};
	} = $props();

	// Collapse state — persisted in localStorage
	let collapsed = $state(browser ? localStorage.getItem('sidebar.collapsed') === 'true' : false);

	function toggleCollapse() {
		collapsed = !collapsed;
		if (browser) localStorage.setItem('sidebar.collapsed', String(collapsed));
	}

	// Year list — flat, newest first. The previous version split this into
	// 5-most-recent + decade-bucketed-older with inline expand. With the
	// year column now always populated (UDP year → start_date → end_date
	// fallback chain in animeFetch.ts), the list is short enough that a
	// flat render is clearer than the nested UI. Buckets dropped 2026-05-17.
	const yearsSorted = $derived(
		[...(counts?.year ?? [])].sort((a, b) => b.year - a.year)
	);

	const statusItems = [
		{ key: 'watching', label: 'Watching', color: 'var(--status-watching)' },
		{ key: 'plan', label: 'Plan to Watch', color: 'var(--status-plan)' },
		{ key: 'completed', label: 'Completed', color: 'var(--status-completed)' },
		{ key: 'on_hold', label: 'On Hold', color: 'var(--status-on-hold)' },
		{ key: 'dropped', label: 'Dropped', color: 'var(--status-dropped)' }
	];

	function setParam(key: string, value: string | null) {
		const u = new URL($page.url);
		const current = u.searchParams.get(key);
		if (current === value) {
			u.searchParams.delete(key);
		} else if (value === null) {
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

	// World-anime top nav (no status filters)
	const worldNav = [
		{ label: 'All', href: '/world-anime?sort=all' },
		{ label: 'Top', href: '/world-anime?sort=rating' },
		{ label: 'Latest', href: '/world-anime?sort=latest' },
		{ label: 'Upcoming', href: '/world-anime?sort=upcoming' }
	];

	function isHrefActive(href: string): boolean {
		const u = new URL(href, $page.url);
		if (u.pathname !== $page.url.pathname) return false;
		for (const [k, v] of u.searchParams) {
			if ($page.url.searchParams.get(k) !== v) return false;
		}
		return true;
	}
</script>

<aside class="sidebar" class:collapsed>
	<!-- Collapse toggle button -->
	<button
		class="collapse-btn"
		onclick={toggleCollapse}
		title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
	>
		{collapsed ? '»' : '«'}
	</button>

	{#if !collapsed}
		{#if tab === 'my'}
			<!-- Status group (My Anime only) -->
			<details open>
				<summary class="group-header">Status</summary>
				<ul class="nav-list">
					<li>
						<button
							class="nav-item"
							class:active={!$page.url.searchParams.has('status')}
							onclick={() => setParam('status', null)}
						>
							<span class="dot" style="background:var(--text-dim)"></span>
							<span class="label">All</span>
							{#if counts?.status}
								<span class="count">{Object.values(counts.status).reduce((a, b) => a + b, 0)}</span>
							{/if}
						</button>
					</li>
					{#each statusItems as st}
						{@const n = counts?.status?.[st.key as keyof StatusCounts] ?? 0}
						{#if n > 0 || !counts}
							<li>
								<button
									class="nav-item"
									class:active={isActive('status', st.key)}
									onclick={() => setParam('status', st.key)}
								>
									<span class="dot" style="background:{st.color}"></span>
									<span class="label">{st.label}</span>
									{#if counts?.status}
										<span class="count">{n}</span>
									{/if}
								</button>
							</li>
						{/if}
					{/each}
				</ul>
			</details>
		{:else}
			<!-- World anime quick nav -->
			<ul class="nav-list" style="margin-bottom:var(--space-4)">
				{#each worldNav as nav}
					<li>
						<a href={nav.href} class="nav-item" class:active={isHrefActive(nav.href)}>
							<span class="label">{nav.label}</span>
						</a>
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Year group -->
		<details open>
			<summary class="group-header">Year</summary>
			<ul class="nav-list">
				<li>
					<button
						class="nav-item"
						class:active={!$page.url.searchParams.has('year')}
						onclick={() => setParam('year', null)}
					>
						<span class="label">All years</span>
					</button>
				</li>
				{#each yearsSorted as y}
					<li>
						<button
							class="nav-item"
							class:active={isActive('year', String(y.year))}
							onclick={() => setParam('year', String(y.year))}
						>
							<span class="label">{y.year}</span>
							<span class="count">{y.count}</span>
						</button>
					</li>
				{/each}
				<!-- Clickable Unknown row — filters to year IS NULL.
				     Sentinel value 'unknown' is read by the page-load layer +
				     /api/anime and translated to ListParams.yearNull = true.
				     Older anime fetched before the year-string fix wrote NULL to
				     anime.year; these self-heal on natural 14-day TTL re-fetch. -->
				{#if counts?.yearUnknown}
					<li>
						<button
							class="nav-item"
							class:active={isActive('year', 'unknown')}
							onclick={() => setParam('year', 'unknown')}
							title="Anime with no recorded year"
						>
							<span class="label">Unknown</span>
							<span class="count">{counts.yearUnknown}</span>
						</button>
					</li>
				{/if}
			</ul>
		</details>
	{:else}
		<!-- Collapsed: icon-only indicators -->
		{#if tab === 'my'}
			{#each statusItems as st}
				<div class="dot-only" style="background:{st.color}" title={st.label}></div>
			{/each}
		{/if}
	{/if}
</aside>

<style>
	.sidebar {
		width: var(--sidebar-w);
		flex: 0 0 var(--sidebar-w);
		background: var(--surface);
		border-right: 1px solid var(--border);
		padding: var(--space-3) var(--space-2) var(--space-3) var(--space-3);
		overflow-y: auto;
		overflow-x: hidden;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		transition:
			width var(--t-base) var(--ease-out),
			flex-basis var(--t-base) var(--ease-out);
		position: relative;
	}
	.sidebar.collapsed {
		width: var(--sidebar-w-collapsed);
		flex: 0 0 var(--sidebar-w-collapsed);
		padding: var(--space-3) var(--space-2);
	}

	/* ── Collapse button ── */
	.collapse-btn {
		align-self: flex-end;
		background: transparent;
		color: var(--text-dim);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		width: 22px;
		height: 22px;
		font-size: 11px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}
	.collapse-btn:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	/* ── Group headings ── */
	details {
		border: none;
	}
	.group-header {
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: var(--space-1) 0;
		cursor: pointer;
		list-style: none;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		user-select: none;
	}
	.group-header::-webkit-details-marker {
		display: none;
	}
	details[open] .group-header::before {
		content: '▾';
	}
	details:not([open]) .group-header::before {
		content: '▸';
	}

	/* ── Nav items ── */
	.nav-list {
		list-style: none;
		padding: 0;
		margin: var(--space-1) 0 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--text-muted);
		font-size: var(--text-sm);
		background: transparent;
		border: none;
		cursor: pointer;
		text-decoration: none;
		text-align: left;
		transition:
			background var(--t-fast),
			color var(--t-fast);
		border-left: 2px solid transparent;
	}
	.nav-item:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.nav-item.active {
		background: var(--accent-soft);
		color: var(--text);
		border-left-color: var(--accent);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.count {
		font-size: var(--text-xs);
		color: var(--text-dim);
		flex-shrink: 0;
	}

	/* Collapsed icon dots */
	.dot-only {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		margin: var(--space-1) auto;
	}

	/* Mobile: hide sidebar entirely — filter chips in TopBar/FilterBar suffice */
	@media (max-width: 640px) {
		.sidebar {
			display: none;
		}
	}
</style>
