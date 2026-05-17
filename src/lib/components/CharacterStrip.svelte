<script lang="ts">
	import type { AnimeDetail } from '$lib/server/db/queries/animeDetail';
	let { characters }: { characters: AnimeDetail['characters'] } = $props();
</script>

{#if characters.length}
	<div class="strip">
		<div class="row">
			{#each characters.slice(0, 20) as c}
				<div class="char">
					<div class="avatar-wrap">
						{#if c.pic}
							<img
								class="avatar"
								src="/img/anidb/{c.pic}"
								alt={c.name_translit ?? ''}
								loading="lazy"
								referrerpolicy="no-referrer"
							/>
						{:else}
							<div class="avatar placeholder"></div>
						{/if}
					</div>
					<span class="name">{c.name_translit ?? `char:${c.char_id}`}</span>
					{#if c.appearance !== null}
						<span class="role">{c.appearance === 1 ? 'Main' : 'Sub'}</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.strip {
		overflow: hidden;
	}
	.row {
		display: flex;
		gap: var(--space-4);
		overflow-x: auto;
		padding: var(--space-2) 0 var(--space-3);
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.char {
		flex: 0 0 72px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-1);
		text-align: center;
	}

	.avatar-wrap {
		width: 72px;
		height: 72px;
		border-radius: 50%;
		overflow: hidden;
		background: var(--surface-2);
		border: 2px solid var(--border);
		transition:
			transform var(--t-fast) var(--ease-out),
			border-color var(--t-fast);
	}
	.char:hover .avatar-wrap {
		transform: scale(1.05);
		border-color: var(--accent);
	}

	.avatar {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.placeholder {
		background: linear-gradient(135deg, var(--surface-2), var(--surface-3));
	}

	.name {
		font-size: var(--text-xs);
		color: var(--text);
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 72px;
	}
	.role {
		font-size: 10px;
		color: var(--text-dim);
	}
</style>
