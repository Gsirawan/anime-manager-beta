<script lang="ts">
	let {
		icon = '📭',
		title,
		description,
		actionLabel,
		onAction
	}: {
		icon?: string;
		title: string;
		description: string;
		actionLabel?: string;
		onAction?: () => void;
	} = $props();
</script>

<div class="empty">
	<span class="icon" aria-hidden="true">{icon}</span>
	<h3>{title}</h3>
	<p>{description}</p>
	{#if actionLabel && onAction}
		<button class="btn btn-primary" onclick={onAction}>{actionLabel}</button>
	{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 240px;
		gap: var(--space-3);
		padding: var(--space-10);
		text-align: center;
	}
	.icon {
		font-size: 2.5rem;
		line-height: 1;
	}
	h3 {
		margin: 0;
		font-size: var(--text-lg);
		color: var(--text);
	}
	p {
		margin: 0;
		font-size: var(--text-sm);
		color: var(--text-muted);
		max-width: 320px;
	}
</style>
