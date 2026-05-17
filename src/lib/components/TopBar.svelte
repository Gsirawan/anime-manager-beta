<script lang="ts">
	import { page } from '$app/stores';
	import { searchQuery } from '$lib/stores/searchQuery';
	import JobIndicator from './JobIndicator.svelte';

	const tab = $derived($page.url.pathname.startsWith('/world-anime') ? 'world' : 'my');

	function go(target: 'my' | 'world') {
		// Clear search when switching tabs
		searchQuery.set('');
		const u = new URL(target === 'my' ? '/my-anime' : '/world-anime', $page.url);
		location.assign(u);
	}
</script>

<header class="topbar">
	<!-- Brand -->
	<a class="brand" href="/">
		<img class="brand-img" src="/logo.png" alt="" width="28" height="28" />
		<span class="brand-name">animanager</span>
	</a>

	<!-- Tab pills -->
	<nav class="tabs" aria-label="Main navigation">
		<button class="tab-pill" class:active={tab === 'my'} onclick={() => go('my')}>
			My Anime
		</button>
		<button class="tab-pill" class:active={tab === 'world'} onclick={() => go('world')}>
			World Anime
		</button>
	</nav>

	<div class="spacer"></div>

	<!-- Live search -->
	<div class="search-wrap">
		<span class="search-icon" aria-hidden="true">🔍</span>
		<input
			type="search"
			class="search-input"
			placeholder="Search anime…"
			value={$searchQuery}
			oninput={(e) => searchQuery.set((e.target as HTMLInputElement).value)}
			aria-label="Search anime"
		/>
	</div>

	<!-- Action icons -->
	<div class="actions">
		<a class="icon-btn" href="/settings" title="Settings"> ⚙ </a>
		<JobIndicator />
	</div>
</header>

<style>
	.topbar {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: 0 var(--space-4);
		height: var(--header-h);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
		position: sticky;
		top: 0;
		z-index: 10;
		flex-shrink: 0;
	}

	/* ── Brand ── */
	.brand {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-decoration: none;
		flex-shrink: 0;
	}
	.brand-img {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		object-fit: cover;
		display: block;
		box-shadow: var(--shadow-sm);
	}
	.brand-name {
		font-size: var(--text-md);
		font-weight: 700;
		color: var(--text);
		letter-spacing: -0.01em;
	}

	/* ── Tab pills ── */
	.tabs {
		display: flex;
		gap: var(--space-1);
	}
	.tab-pill {
		background: transparent;
		color: var(--text-muted);
		border: none;
		padding: var(--space-1) var(--space-4);
		border-radius: var(--radius-pill);
		font-size: var(--text-sm);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.tab-pill:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.tab-pill.active {
		background: var(--accent-soft);
		color: var(--text);
	}

	.spacer {
		flex: 1;
	}

	/* ── Search ── */
	.search-wrap {
		position: relative;
		flex: 0 1 320px;
		min-width: 160px;
	}
	.search-icon {
		position: absolute;
		left: var(--space-2);
		top: 50%;
		transform: translateY(-50%);
		font-size: 13px;
		pointer-events: none;
		opacity: 0.5;
	}
	.search-input {
		width: 100%;
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
		padding: var(--space-1) var(--space-3) var(--space-1) calc(var(--space-3) + 16px);
		font-size: var(--text-sm);
		outline: none;
		transition: border-color var(--t-fast);
	}
	.search-input::placeholder {
		color: var(--text-dim);
	}
	.search-input:focus {
		border-color: var(--accent);
	}
	/* Remove native clear button from Safari */
	.search-input::-webkit-search-decoration,
	.search-input::-webkit-search-cancel-button {
		-webkit-appearance: none;
	}

	/* ── Action icons ── */
	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		flex-shrink: 0;
	}

	/* ── Mobile (≤640px) ──
	   Two-row layout: tabs+actions on top, search on its own row below.
	   The search bar was cramped to ~80px on the desktop single-row layout,
	   so the user couldn't read what they were typing. Wrapping it to a
	   dedicated row gives it full width.

	   Mechanism: enable flex-wrap on .topbar, drop the fixed height (let
	   the row count drive height), promote .search-wrap to flex-basis 100%
	   so it wraps onto a second line, hide the now-empty .spacer so it
	   doesn't eat layout space on either row. Ordering: tabs/actions are
	   the natural order; search-wrap uses order: 99 to land last (= second
	   row). FilterBar sits below the topbar in the parent layout, so the
	   end result is exactly the row stack Ghaith asked for:
	     row 1 — brand · tabs · actions
	     row 2 — search (full width)
	     row 3 — filter chips (FilterBar component, separate). */
	@media (max-width: 640px) {
		.topbar {
			gap: var(--space-2);
			padding: var(--space-2);
			height: auto;
			min-height: var(--header-h);
			flex-wrap: wrap;
			row-gap: var(--space-2);
		}
		.brand-name {
			display: none; /* logo only — saves ~110px */
		}
		.tabs {
			gap: 0;
		}
		.tab-pill {
			padding: var(--space-1) var(--space-2);
			font-size: var(--text-xs);
			white-space: nowrap;
		}
		.spacer {
			display: none;
		}
		.search-wrap {
			order: 99;
			flex: 1 1 100%;
			min-width: 0;
			max-width: 100%;
		}
		.search-input {
			font-size: var(--text-sm);
			padding-top: var(--space-2);
			padding-bottom: var(--space-2);
		}
	}
</style>
