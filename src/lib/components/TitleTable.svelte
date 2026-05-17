<script lang="ts">
	import type { AnimeDetail } from '$lib/server/db/queries/animeDetail';

	let { titles }: { titles: AnimeDetail['titles'] } = $props();
</script>

{#if titles.length === 0}
	<p class="empty">No title data available.</p>
{:else}
	<div class="wrap">
		<table class="title-table">
			<thead>
				<tr>
					<th class="col-lang">Lang</th>
					<th class="col-type">Type</th>
					<th class="col-title">Title</th>
				</tr>
			</thead>
			<tbody>
				{#each titles as t}
					<tr>
						<td class="col-lang"><code>{t.lang}</code></td>
						<td class="col-type">{t.type}</td>
						<td class="col-title">{t.title}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}

<style>
	.wrap {
		padding: var(--space-6);
		overflow-x: auto;
	}
	.empty {
		padding: var(--space-6);
		color: var(--text-muted);
		font-size: var(--text-sm);
	}
	.title-table {
		width: 100%;
		max-width: 960px;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.title-table thead th {
		text-align: left;
		color: var(--text-muted);
		font-weight: 500;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
	}
	.title-table tbody td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		color: var(--text);
	}
	.title-table tbody tr:hover td {
		background: rgba(255, 255, 255, 0.02);
	}
	.col-lang code {
		background: var(--surface-2);
		padding: 1px var(--space-1);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
	}
	.col-type {
		color: var(--text-muted);
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.col-title {
		font-weight: 500;
	}
</style>
