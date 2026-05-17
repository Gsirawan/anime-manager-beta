<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';
	import DetailHero from '$lib/components/DetailHero.svelte';
	import CharacterStrip from '$lib/components/CharacterStrip.svelte';
	import InfoList from '$lib/components/InfoList.svelte';
	import TitleTable from '$lib/components/TitleTable.svelte';
	import TagTable from '$lib/components/TagTable.svelte';

	let { data }: { data: PageData } = $props();

	let detail = $state(data.detail);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	// Tab resolution:
	//   - missing param  → 'description' (default landing tab)
	//   - 'overview'     → 'description' for back-compat with old bookmarks
	//   - anything else  → as-is (unknown values fall through to the description
	//                      branch via {:else} in the tab cascade)
	const activeTab = $derived.by(() => {
		const raw = $page.url.searchParams.get('tab');
		if (raw === null || raw === 'overview') return 'description';
		return raw;
	});

	function handleTabChange(tab: string) {
		const u = new URL($page.url);
		u.searchParams.set('tab', tab);
		goto(u, { replaceState: true });
	}

	async function poll() {
		const r = await fetch(`/api/anime/${data.aid}`);
		if (r.status === 200) {
			const j = await r.json();
			if (j.ok && j.data?.anime) {
				detail = j.data;
				stop();
			}
		}
	}
	function stop() {
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	onMount(() => {
		if (!detail) pollTimer = setInterval(poll, 3000);
	});
	onDestroy(stop);
</script>

{#if data.tombstoned}
	<div class="oos">
		<div class="back-row">
			<button
				class="back-btn"
				onclick={() => (history.length > 1 ? history.back() : goto('/world-anime'))}
				aria-label="Back"
			>
				← Back
			</button>
		</div>
		<h1>This anime is out of scope</h1>
		{#if data.tombstoneReason === 'non_japanese'}
			<p>animanager tracks Japanese-origin anime only. AniDB classifies this title as non-Japanese.</p>
		{:else if data.tombstoneReason === 'no_such_anime'}
			<p>AniDB has no record of this anime ID.</p>
		{:else}
			<p>This anime has been excluded from results.</p>
		{/if}
		{#if data.inMylist}
			<p class="muted">
				This entry is still in your mylist. Remove it from My Anime if you no longer want it tracked.
			</p>
		{/if}
	</div>
{:else if detail}
	<article class="detail-page">
		<!-- Back row — own band above the hero, shifts everything below down -->
		<div class="back-row">
			<button
				class="back-btn"
				onclick={() => (history.length > 1 ? history.back() : goto('/my-anime'))}
				aria-label="Back to list"
			>
				← Back
			</button>
		</div>

		<DetailHero {detail} {activeTab} onTabChange={handleTabChange} />

		<div class="tab-content">
			{#if activeTab === 'info'}
				<InfoList {detail} />
			{:else if activeTab === 'titles'}
				<TitleTable titles={detail.titles} />
			{:else if activeTab === 'tags'}
				<TagTable tags={detail.tags} />
			{:else if activeTab === 'characters'}
				{#if detail.characters.length}
					<CharacterStrip characters={detail.characters} />
				{:else}
					<div class="empty-tab">No character data available.</div>
				{/if}
			{:else if activeTab === 'related'}
				{#if detail.relations.length}
					<ul class="related-list">
						{#each detail.relations as rel}
							<li>
								<a href="/anime/{rel.related_aid}">
									{rel.related_aid} · <span class="rel-type">{rel.type}</span>
								</a>
							</li>
						{/each}
					</ul>
				{:else}
					<div class="empty-tab">No related anime found.</div>
				{/if}
			{:else}
				<!-- description (default + fallback for unknown values) -->
				{#if detail.anime.description}
					<section class="desc">
						<p>{detail.anime.description}</p>
					</section>
				{/if}
				{#if detail.characters.length}
					<section class="chars-section">
						<h3 class="section-heading">Characters</h3>
						<CharacterStrip characters={detail.characters} />
					</section>
				{/if}
			{/if}
		</div>
	</article>
{:else}
	<div class="loading">
		<p>Fetching anime details from AniDB…</p>
		<p class="muted">Queued as job #{data.jobId}. This usually takes a few seconds.</p>
	</div>
{/if}

<style>
	.detail-page {
		overflow-y: auto;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	/* ── Back row ──
	   Dedicated band above the hero. In-flow, not floating — DetailHero and
	   everything below it sits underneath this row. */
	.back-row {
		flex-shrink: 0;
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border-bottom: 1px solid var(--border);
	}
	.back-btn {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		padding: var(--space-1) var(--space-3);
		border-radius: var(--radius-md);
		font-size: var(--text-sm);
		cursor: pointer;
		transition:
			background var(--t-fast),
			border-color var(--t-fast),
			color var(--t-fast);
	}
	.back-btn:hover {
		background: var(--accent);
		border-color: var(--accent);
		color: white;
	}

	.tab-content {
		flex: 1;
		padding: var(--space-6);
		max-width: 900px;
	}

	.desc p {
		color: var(--text);
		line-height: 1.65;
		white-space: pre-wrap;
		font-size: var(--text-base);
		margin: 0;
	}

	.chars-section {
		margin-top: var(--space-8);
	}
	.section-heading {
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0 0 var(--space-3);
	}

	.related-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}
	.related-list a {
		color: var(--text);
		text-decoration: none;
		font-size: var(--text-sm);
	}
	.related-list a:hover {
		color: var(--accent);
	}
	.rel-type {
		color: var(--text-muted);
		font-size: var(--text-xs);
	}

	.empty-tab {
		padding: var(--space-8);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}

	.loading {
		padding: var(--space-8);
		text-align: center;
		color: var(--text);
	}
	.muted {
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.oos {
		max-width: 560px;
		margin: var(--space-8) auto;
		padding: 0 var(--space-4);
		text-align: center;
		color: var(--text);
	}
	.oos .back-row {
		text-align: left;
		background: transparent;
		border: none;
		padding-bottom: var(--space-6);
	}
	.oos h1 {
		font-size: var(--text-2xl);
		margin: var(--space-6) 0 var(--space-3) 0;
	}
	.oos p {
		margin: var(--space-2) 0;
	}
</style>
