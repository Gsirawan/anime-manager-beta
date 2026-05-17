<script lang="ts">
	import type { WatchStatus } from '$lib/types';
	let {
		aid,
		current = $bindable(),
		epsWatched = 0
	}: {
		aid: number;
		current: WatchStatus | null;
		epsWatched?: number;
	} = $props();

	const options: { value: WatchStatus; label: string }[] = [
		{ value: 'plan', label: 'Plan to Watch' },
		{ value: 'watching', label: 'Watching' },
		{ value: 'completed', label: 'Completed' },
		{ value: 'on_hold', label: 'On Hold' },
		{ value: 'dropped', label: 'Dropped' }
	];

	// Local state mirrors the bindable prop for optimistic updates
	let localStatus = $state<WatchStatus | null>(current);
	let busy = $state(false);
	let error = $state<string | null>(null);

	async function set(status: WatchStatus) {
		busy = true;
		error = null;
		const optimistic = localStatus;
		localStatus = status;
		current = status;
		try {
			const method = optimistic !== null ? 'PATCH' : 'POST';
			const url = optimistic !== null ? `/api/mylist/${aid}` : '/api/mylist';
			const body = optimistic !== null ? { status } : { aid, status };
			const r = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			const j = await r.json();
			if (!j.ok) {
				localStatus = optimistic;
				current = optimistic;
				error = j.error?.message ?? 'failed';
			}
		} catch (e) {
			localStatus = optimistic;
			current = optimistic;
			error = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		busy = true;
		error = null;
		const optimistic = localStatus;
		localStatus = null;
		current = null;
		try {
			const r = await fetch(`/api/mylist/${aid}`, { method: 'DELETE' });
			const j = await r.json();
			if (!j.ok) {
				localStatus = optimistic;
				current = optimistic;
				error = j.error?.message ?? 'failed';
			}
		} finally {
			busy = false;
		}
	}
</script>

<div class="actions">
	{#if !localStatus}
		<button class="primary" onclick={() => set('plan')} disabled={busy}>+ Add to My Anime</button>
	{:else}
		<select
			value={localStatus}
			onchange={(e) => set(e.currentTarget.value as WatchStatus)}
			disabled={busy}
		>
			{#each options as o}<option value={o.value}>{o.label}</option>{/each}
		</select>
		<span class="eps">{epsWatched} watched</span>
		<button onclick={remove} disabled={busy} class="danger">Remove</button>
	{/if}
	{#if error}<span class="error">{error}</span>{/if}
</div>

<style>
	.actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.primary {
		background: var(--accent);
		color: white;
		border: none;
		padding: 0.4rem 0.9rem;
		border-radius: var(--radius);
		cursor: pointer;
	}
	.danger {
		background: transparent;
		color: var(--error);
		border: 1px solid var(--error);
		padding: 0.3rem 0.7rem;
		border-radius: var(--radius);
		cursor: pointer;
	}
	select {
		background: var(--surface-2);
		color: var(--text);
		border: 1px solid var(--border);
		padding: 0.3rem 0.5rem;
		border-radius: var(--radius);
	}
	.eps {
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	.error {
		color: var(--error);
		font-size: 0.8rem;
	}
</style>
