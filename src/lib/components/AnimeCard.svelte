<script lang="ts">
	import type { AnimeCardData, WatchStatus } from '$lib/types';
	import { quickAdd } from '$lib/mylist/quickAdd';

	let {
		card,
		selectMode = false,
		selected = false,
		onSelectToggle
	}: {
		card: AnimeCardData;
		selectMode?: boolean;
		selected?: boolean;
		onSelectToggle?: (aid: number) => void;
	} = $props();

	function handleClick(e: MouseEvent) {
		if (selectMode) {
			e.preventDefault();
			onSelectToggle?.(card.aid);
		}
	}

	const cover = $derived(card.picname ? `/img/anidb/${card.picname}` : null);

	// Local optimistic state for mylist status (mirrors card.mylist_status until server confirms)
	let mylistStatus = $state<WatchStatus | null | undefined>(card.mylist_status);
	let favLoading = $state(false);

	const statusColor: Record<string, string> = {
		plan: 'var(--status-plan)',
		watching: 'var(--status-watching)',
		completed: 'var(--status-completed)',
		on_hold: 'var(--status-on-hold)',
		dropped: 'var(--status-dropped)'
	};

	async function handleFav(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (favLoading) return;
		favLoading = true;
		try {
			mylistStatus = await quickAdd(card.aid, mylistStatus);
		} catch {
			// silently revert on error
		} finally {
			favLoading = false;
		}
	}


</script>

<a
	class="card"
	class:selectable={selectMode}
	class:selected
	class:restricted={card.restricted === 1}
	href="/anime/{card.aid}"
	onclick={handleClick}
>
	<div class="cover">
		{#if cover}
			<img src={cover} alt={card.title} loading="lazy" referrerpolicy="no-referrer" />
		{:else}
			<div class="placeholder"></div>
		{/if}

		<!-- NSFW: restricted cards stay blurred on the grid (no unblur control).
		     The detail page renders the full image — go there to view. -->

		<!-- Select checkbox — top-right, visible only in select mode -->
		{#if selectMode}
			<span class="select-check" class:checked={selected} aria-hidden="true">
				{selected ? '✓' : ''}
			</span>
		{/if}

		<!-- Fav button — top-left, appears on hover -->
		<button
			class="fav-btn"
			class:active={!!mylistStatus}
			aria-label={mylistStatus ? 'Remove from list' : 'Add to list'}
			onclick={handleFav}
			disabled={favLoading}
		>
			{mylistStatus ? '♥' : '♡'}
		</button>

		<!-- Status badge — top-right (hidden in select mode to make room for check) -->
		{#if mylistStatus && !selectMode}
			<span class="status-badge" style="background:{statusColor[mylistStatus] ?? 'var(--accent)'}">
				{mylistStatus.replace('_', ' ')}
			</span>
		{/if}

		<!-- Rating — bottom-left -->
		{#if card.rating}
			<span class="rating-badge">★ {card.rating.toFixed(1)}</span>
		{/if}

		<!-- Tombstone badge — only on my-tab cards that have been classified
			 out of scope (post-fetch origin classifier returned 'tombstone').
			 Surfaces the warning without auto-removing the user's entry. -->
		{#if card.tombstoned}
			<span class="tombstone-badge" title="Not Japanese-origin — remove from mylist to dismiss">
				Out of scope
			</span>
		{/if}
	</div>

	<div class="meta">
		<div class="title" title={card.title}>{card.title}</div>
		<div class="sub">
			{card.type ?? ''}
			{#if card.episode_count}&nbsp;·&nbsp;{card.episode_count} ep{/if}
			{#if card.year}&nbsp;·&nbsp;{card.year}{/if}
		</div>
	</div>
</a>

<style>
	.card {
		position: relative;
		display: block;
		background: var(--surface-2);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		overflow: hidden;
		text-decoration: none;
		color: var(--text);
		transition:
			transform var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out),
			box-shadow var(--t-fast) var(--ease-out);
	}
	.card.selected {
		border-color: var(--accent);
		box-shadow: var(--shadow-glow);
	}
	.card.selectable {
		cursor: pointer;
	}
	.card.selectable .fav-btn {
		display: none;
	}
	.card:hover {
		transform: translateY(-4px);
		border-color: var(--accent);
		box-shadow: var(--shadow-glow);
	}
	.card:hover .fav-btn {
		opacity: 1;
	}

	/* ── Cover ──
	   Padding-bottom 150% is the bulletproof aspect-ratio technique.
	   Percentage padding is relative to PARENT WIDTH, so we always get
	   height = width × 1.5 (i.e. 2:3 portrait), regardless of grid row
	   compression or empty content. */
	.cover {
		position: relative;
		width: 100%;
		padding-bottom: 150%;
		background: var(--surface);
		overflow: hidden;
	}
	.cover img,
	.cover .placeholder {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.cover img {
		object-fit: cover;
		transition: transform var(--t-base) var(--ease-out);
	}
	.card:hover .cover img {
		transform: scale(1.03);
	}
	.placeholder {
		background: linear-gradient(135deg, var(--surface-2), var(--surface));
	}

	/* ── NSFW veil ──
	   Restricted cards stay blurred on the grid. There is no per-card
	   unblur control by design — the user navigates to the detail page
	   if they want to view the cover. */
	.card.restricted .cover img {
		filter: blur(18px) brightness(0.7);
	}

	/* ── Fav button ── */
	.fav-btn {
		position: absolute;
		top: var(--space-2);
		left: var(--space-2);
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: rgba(15, 17, 23, 0.82);
		color: var(--text);
		border: 1px solid rgba(255, 255, 255, 0.15);
		font-size: 15px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
		z-index: 3;
		backdrop-filter: blur(4px);
		line-height: 1;
		padding: 0;
	}
	.fav-btn:hover {
		background: var(--accent);
		border-color: var(--accent);
		transform: scale(1.1);
	}
	.fav-btn.active {
		opacity: 1;
		color: oklch(75% 0.22 12);
	}
	.fav-btn:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	/* ── Select checkbox — top-right (replaces status badge slot in select mode) ── */
	.select-check {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 4;
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: rgba(15, 17, 23, 0.7);
		border: 2px solid rgba(255, 255, 255, 0.9);
		color: white;
		font-size: 14px;
		font-weight: 700;
		display: flex;
		align-items: center;
		justify-content: center;
		backdrop-filter: blur(4px);
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.select-check.checked {
		background: var(--accent);
		border-color: var(--accent);
	}

	/* ── Status badge — top-right ── */
	.status-badge {
		position: absolute;
		top: var(--space-2);
		right: var(--space-2);
		z-index: 2;
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: white;
		font-weight: 600;
		text-transform: capitalize;
		letter-spacing: 0.02em;
	}

	/* ── Rating badge — bottom-left ── */
	.rating-badge {
		position: absolute;
		bottom: var(--space-2);
		left: var(--space-2);
		z-index: 2;
		background: rgba(0, 0, 0, 0.65);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--text);
		backdrop-filter: blur(4px);
	}

	/* ── Tombstone badge — top center over the cover ──
	   Warm accent (rose-ish) so it stands out from status badges. Sits in
	   front of all other overlays. */
	.tombstone-badge {
		position: absolute;
		top: var(--space-2);
		left: 50%;
		transform: translateX(-50%);
		z-index: 5;
		background: oklch(55% 0.18 25 / 0.92);
		color: white;
		padding: 2px var(--space-3);
		border-radius: 999px;
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		backdrop-filter: blur(4px);
		white-space: nowrap;
	}

	/* ── Meta ── */
	.meta {
		padding: var(--space-2) var(--space-3);
	}
	.title {
		font-size: var(--text-sm);
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--text-muted);
		margin-top: 2px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
