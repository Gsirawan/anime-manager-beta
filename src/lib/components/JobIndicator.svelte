<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { jobStatus, startJobStatusPolling, stopJobStatusPolling } from '$lib/stores/jobStatus';
	onMount(() => startJobStatusPolling());
	onDestroy(() => stopJobStatusPolling());

	const paused = $derived($jobStatus.paused_until > Date.now());
	const active = $derived($jobStatus.running > 0 || $jobStatus.pending > 0);
	const hasError = $derived(!!$jobStatus.last_error && $jobStatus.failed > 0);

	const tooltipText = $derived(
		`Pending: ${$jobStatus.pending} · Running: ${$jobStatus.running} · Failed: ${$jobStatus.failed}` +
			(paused ? ` · Rate-limited` : '') +
			(hasError ? ` · Error: ${$jobStatus.last_error}` : '')
	);
</script>

<div
	class="indicator"
	class:active
	class:error={hasError}
	class:paused
	title={tooltipText}
	aria-label={tooltipText}
>
	<span class="dot" class:pulse={active}></span>
	{#if paused}
		<span class="label">paused</span>
	{:else if hasError}
		<span class="label">error</span>
	{:else if active}
		<span class="label">{$jobStatus.running + $jobStatus.pending}</span>
	{/if}
</div>

<style>
	.indicator {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-pill);
		font-size: var(--text-xs);
		color: var(--text-dim);
		cursor: default;
		user-select: none;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-dim);
		flex-shrink: 0;
		transition: background var(--t-fast);
	}
	.indicator.active .dot {
		background: var(--accent);
	}
	.indicator.error .dot {
		background: var(--error);
	}
	.indicator.paused .dot {
		background: var(--warning);
	}

	.dot.pulse {
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot.pulse {
			animation: none;
		}
	}

	.label {
		color: var(--text-muted);
	}
</style>
