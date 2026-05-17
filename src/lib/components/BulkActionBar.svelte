<script lang="ts">
	import type { WatchStatus } from '$lib/types';

	let {
		count,
		busy = false,
		onApply,
		onRemove,
		onExport,
		onClear
	}: {
		count: number;
		busy?: boolean;
		onApply: (status: WatchStatus) => void;
		onRemove: () => void;
		onExport: () => void;
		onClear: () => void;
	} = $props();

	let menuOpen = $state(false);

	const statuses: { value: WatchStatus; label: string; color: string }[] = [
		{ value: 'watching', label: 'Watching', color: 'var(--status-watching)' },
		{ value: 'plan', label: 'Plan to Watch', color: 'var(--status-plan)' },
		{ value: 'completed', label: 'Completed', color: 'var(--status-completed)' },
		{ value: 'on_hold', label: 'On Hold', color: 'var(--status-on-hold)' },
		{ value: 'dropped', label: 'Dropped', color: 'var(--status-dropped)' }
	];

	function handleApply(s: WatchStatus) {
		menuOpen = false;
		onApply(s);
	}
</script>

<div class="bar" role="region" aria-label="Bulk actions">
	<span class="count"><strong>{count}</strong> selected</span>

	<div class="mark-wrap">
		<button
			class="btn btn-primary"
			onclick={() => (menuOpen = !menuOpen)}
			disabled={busy}
			aria-haspopup="menu"
			aria-expanded={menuOpen}
		>
			Mark as <span class="caret">▾</span>
		</button>
		{#if menuOpen}
			<ul class="menu" role="menu">
				{#each statuses as s}
					<li>
						<button onclick={() => handleApply(s.value)} role="menuitem">
							<span class="dot" style="background:{s.color}"></span>
							{s.label}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	<button class="btn btn-ghost danger" onclick={onRemove} disabled={busy}>Remove</button>

	<button class="btn btn-ghost" onclick={onExport} disabled={busy} title="Copy aids to clipboard">
		Export aids
	</button>

	<button class="close" onclick={onClear} aria-label="Clear selection" disabled={busy}>✕</button>
</div>

<style>
	.bar {
		position: fixed;
		bottom: var(--space-4);
		left: 50%;
		transform: translateX(-50%);
		z-index: 50;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
		max-width: calc(100vw - var(--space-4) * 2);
	}

	.count {
		font-size: var(--text-sm);
		color: var(--text-muted);
		padding: 0 var(--space-2);
	}
	.count strong {
		color: var(--text);
		font-weight: 700;
	}

	.mark-wrap {
		position: relative;
	}
	.caret {
		font-size: var(--text-xs);
	}

	/* Dropdown menu pops upward from "Mark as" */
	.menu {
		position: absolute;
		bottom: calc(100% + var(--space-1));
		left: 0;
		min-width: 200px;
		list-style: none;
		margin: 0;
		padding: var(--space-1);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
	}
	.menu li {
		display: block;
	}
	.menu button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		background: transparent;
		border: none;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		color: var(--text);
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
	}
	.menu button:hover {
		background: var(--surface-2);
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.btn.danger {
		color: var(--error);
	}
	.btn.danger:hover {
		background: color-mix(in oklch, var(--error) 15%, transparent);
		border-color: var(--error);
	}

	.close {
		background: transparent;
		color: var(--text-dim);
		border: 1px solid var(--border);
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.close:hover {
		color: var(--text);
		border-color: var(--accent);
	}

	/* Mobile: span the viewport bottom edge */
	@media (max-width: 640px) {
		.bar {
			bottom: 0;
			left: 0;
			right: 0;
			transform: none;
			max-width: 100vw;
			border-radius: 0;
			border-left: none;
			border-right: none;
			justify-content: space-between;
			gap: var(--space-2);
			padding: var(--space-2);
		}
		.count {
			padding: 0;
			font-size: var(--text-xs);
		}
	}
</style>
