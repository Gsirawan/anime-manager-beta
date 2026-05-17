<script lang="ts">
	import type { AnimeDetail } from '$lib/server/db/queries/animeDetail';

	let { tags }: { tags: AnimeDetail['tags'] } = $props();
</script>

{#if tags.length === 0}
	<p class="empty">No tag data returned by AniDB for this anime.</p>
{:else}
	<div class="wrap">
		<table class="tag-table">
			<thead>
				<tr>
					<th class="col-name">Tag</th>
					<th class="col-weight">Weight</th>
				</tr>
			</thead>
			<tbody>
				{#each tags as t}
					<tr>
						<td class="col-name">{t.tag_name}</td>
						<td class="col-weight">{t.weight ?? '—'}</td>
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
	.tag-table {
		width: 100%;
		max-width: 720px;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}
	.tag-table thead th {
		text-align: left;
		color: var(--text-muted);
		font-weight: 500;
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid var(--border);
	}
	.tag-table thead th.col-weight {
		text-align: right;
	}
	.tag-table tbody td {
		padding: var(--space-2) var(--space-3);
		border-bottom: 1px solid rgba(255, 255, 255, 0.04);
		color: var(--text);
	}
	.tag-table tbody tr:hover td {
		background: rgba(255, 255, 255, 0.02);
	}
	.col-weight {
		text-align: right;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
</style>
