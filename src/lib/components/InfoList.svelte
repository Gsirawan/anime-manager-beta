<script lang="ts">
	import type { AnimeDetail } from '$lib/server/db/queries/animeDetail';

	let { detail }: { detail: AnimeDetail } = $props();

	// Formatters

	/** Number with locale grouping (1234 → "1,234"). */
	function fmtCount(n: number | null | undefined): string {
		if (n === null || n === undefined) return '—';
		return n.toLocaleString('en-US');
	}

	/**
	 * Aired window. Month-level precision is reliable; day-level is not
	 * (dateflags is deferred). Renders as:
	 *   "2024-01 → 2024-03"  when both start_date and end_date are set
	 *   "2024-01"            when only start_date is set
	 *   "2024"               when only year is set
	 *   "—"                  otherwise
	 */
	function fmtAired(
		start: number | null,
		end: number | null,
		year: number | null
	): string {
		const fmtMonth = (unix: number) => {
			const d = new Date(unix * 1000);
			const y = d.getUTCFullYear();
			const m = String(d.getUTCMonth() + 1).padStart(2, '0');
			return `${y}-${m}`;
		};
		if (start && end) return `${fmtMonth(start)} → ${fmtMonth(end)}`;
		if (start) return fmtMonth(start);
		if (year) return String(year);
		return '—';
	}

	const aniDbLink = $derived(`https://anidb.net/anime/${detail.anime.aid}`);
</script>

<dl class="info-list">
	<dt>Type</dt>
	<dd>{detail.anime.type ?? '—'}</dd>

	<dt>Episodes</dt>
	<dd>{detail.anime.episode_count ?? '—'}</dd>

	<dt>Aired</dt>
	<dd>{fmtAired(detail.anime.start_date, detail.anime.end_date, detail.anime.year)}</dd>

	<dt>Rating</dt>
	<dd>
		{#if detail.anime.rating !== null && detail.anime.rating !== undefined}
			{detail.anime.rating.toFixed(1)}
			{#if detail.anime.vote_count}
				<span class="muted">({fmtCount(detail.anime.vote_count)} votes)</span>
			{/if}
		{:else}
			—
		{/if}
	</dd>

	{#if detail.anime.restricted === 1}
		<dt>Restricted</dt>
		<dd class="warn">Yes (NSFW)</dd>
	{/if}
</dl>

<p class="anidb-link">
	<a href={aniDbLink} target="_blank" rel="noreferrer noopener">→ View on AniDB</a>
</p>

<style>
	.info-list {
		display: grid;
		grid-template-columns: 140px 1fr;
		row-gap: var(--space-2);
		column-gap: var(--space-4);
		margin: 0 0 var(--space-6) 0;
		padding: var(--space-6);
		max-width: 720px;
	}
	.info-list dt {
		color: var(--text-muted);
		font-size: var(--text-sm);
		font-weight: 500;
	}
	.info-list dd {
		margin: 0;
		color: var(--text);
		font-size: var(--text-sm);
	}
	.muted {
		color: var(--text-muted);
		opacity: 0.8;
		margin-left: var(--space-1);
	}
	.warn {
		color: oklch(75% 0.18 25);
	}
	.anidb-link {
		padding: 0 var(--space-6);
		margin: 0;
	}
	.anidb-link a {
		color: var(--accent);
		text-decoration: none;
		font-size: var(--text-sm);
	}
	.anidb-link a:hover {
		text-decoration: underline;
	}
</style>
