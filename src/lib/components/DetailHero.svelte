<script lang="ts">
	import type { AnimeDetail } from '$lib/server/db/queries/animeDetail';
	import MylistActions from './MylistActions.svelte';

	let {
		detail,
		activeTab = 'description',
		onTabChange
	}: {
		detail: AnimeDetail;
		activeTab?: string;
		onTabChange?: (tab: string) => void;
	} = $props();

	const cover = $derived(
		detail.anime.picname ? `/img/anidb/${detail.anime.picname}` : null
	);
	const mainTitle = $derived(
		detail.titles.find((t) => t.type === 'main')?.title ?? `aid:${detail.anime.aid}`
	);
	const subTitle = $derived(
		detail.titles.find((t) => t.lang === 'ja' || (t.lang === 'x-jat' && t.type === 'main'))?.title
	);

	// @svelte-ignore state_referenced_locally
	let mylistStatus: import('$lib/types').WatchStatus | null = $state(detail.mylist?.status ?? null);

	// Cycle 2: Description default, then three reference tabs (Info, Titles,
	// Tags), then the existing Characters + Related tabs.
	// 'overview' is intentionally absent — the legacy URL ?tab=overview is
	// aliased to 'description' at the page-loader level.
	const tabs = ['description', 'info', 'titles', 'tags', 'characters', 'related'];
</script>

<section class="hero">
	<!-- Blurred backdrop -->
	{#if cover}
		<div class="backdrop" style="background-image:url('{cover}')" aria-hidden="true"></div>
	{/if}
	<div class="backdrop-overlay" aria-hidden="true"></div>

	<!-- Foreground content -->
	<div class="content">
		<!-- Poster -->
		<div class="poster-wrap">
			{#if cover}
				<img class="poster" src={cover} alt={mainTitle} referrerpolicy="no-referrer" />
			{:else}
				<div class="poster-placeholder"></div>
			{/if}
		</div>

		<!-- Info column -->
		<div class="info">
			<!-- Chips row: type / year / eps / rating -->
			<div class="chips-row">
				{#if detail.anime.type}
					<span class="meta-chip accent">{detail.anime.type}</span>
				{/if}
				{#if detail.anime.year}
					<span class="meta-chip">{detail.anime.year}</span>
				{/if}
				{#if detail.anime.episode_count}
					<span class="meta-chip">{detail.anime.episode_count} ep</span>
				{/if}
				{#if detail.anime.rating}
					<span class="meta-chip">★ {detail.anime.rating.toFixed(1)}</span>
				{/if}
			</div>

			<h1 class="title">{mainTitle}</h1>
			{#if subTitle && subTitle !== mainTitle}
				<p class="subtitle">{subTitle}</p>
			{/if}

			<!-- Tags -->
			{#if detail.tags.length}
				<div class="tags">
					{#each detail.tags.slice(0, 6) as t}
						<span class="tag">{t.tag_name}</span>
					{/each}
				</div>
			{/if}

			<MylistActions
				aid={detail.anime.aid}
				bind:current={mylistStatus}
				epsWatched={detail.mylist?.eps_watched ?? 0}
			/>

			{#if detail.anime.description}
				<p class="desc-snippet">{detail.anime.description.slice(0, 240)}…</p>
			{/if}
		</div>
	</div>

	<!-- Tab strip — sticky at bottom of hero -->
	<nav class="tabs" aria-label="Detail page tabs">
		{#each tabs as t}
			<button class="tab" class:active={activeTab === t} onclick={() => onTabChange?.(t)}>
				{t.charAt(0).toUpperCase() + t.slice(1)}
			</button>
		{/each}
	</nav>
</section>

<style>
	.hero {
		position: relative;
		min-height: 380px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* ── Backdrop ── */
	.backdrop {
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center 20%;
		filter: blur(28px) saturate(0.8);
		opacity: 0.55;
		transform: scale(1.1); /* prevent blur edge artifacts */
	}
	.backdrop-overlay {
		position: absolute;
		inset: 0;
		background: linear-gradient(180deg, rgba(15, 17, 23, 0.35) 0%, rgba(15, 17, 23, 0.92) 100%);
	}

	/* ── Foreground ── */
	.content {
		position: relative;
		display: flex;
		gap: var(--space-6);
		padding: var(--space-6);
		flex: 1;
	}

	/* ── Poster ── */
	.poster-wrap {
		flex-shrink: 0;
		width: 180px;
	}
	.poster {
		width: 180px;
		aspect-ratio: 2/3;
		object-fit: cover;
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		border: 1px solid rgba(255, 255, 255, 0.08);
		display: block;
	}
	.poster-placeholder {
		width: 180px;
		aspect-ratio: 2/3;
		border-radius: var(--radius-lg);
		background: var(--surface-2);
	}

	/* ── Info ── */
	.info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		color: var(--text);
		min-width: 0;
	}

	.chips-row {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.meta-chip {
		padding: 2px var(--space-2);
		background: rgba(0, 0, 0, 0.45);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		font-weight: 500;
		color: var(--text);
	}
	.meta-chip.accent {
		background: rgba(96, 77, 221, 0.3);
		color: oklch(85% 0.15 270);
		font-weight: 600;
	}

	.title {
		margin: 0;
		font-size: var(--text-2xl);
		font-weight: 700;
		line-height: 1.2;
		color: var(--text);
	}
	.subtitle {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
		opacity: 0.75;
	}

	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1);
	}
	.tag {
		padding: 2px var(--space-2);
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		color: var(--text-muted);
	}

	.desc-snippet {
		margin: 0;
		font-size: var(--text-sm);
		line-height: 1.6;
		color: var(--text);
		opacity: 0.85;
		flex: 1;
	}

	/* ── Tab strip ── */
	.tabs {
		position: relative;
		display: flex;
		gap: var(--space-6);
		padding: 0 var(--space-6);
		border-top: 1px solid rgba(255, 255, 255, 0.08);
		background: rgba(15, 17, 23, 0.7);
		backdrop-filter: blur(8px);
	}
	.tab {
		padding: var(--space-3) 0;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-muted);
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			color var(--t-fast),
			border-color var(--t-fast);
	}
	.tab:hover {
		color: var(--text);
	}
	.tab.active {
		color: var(--text);
		font-weight: 600;
		border-bottom-color: var(--accent);
	}
</style>
