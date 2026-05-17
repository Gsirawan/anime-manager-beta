<script lang="ts">
	let {
		width = '100%',
		height = '1rem',
		radius = 'var(--radius-md)'
	}: {
		width?: string;
		height?: string;
		radius?: string;
	} = $props();
</script>

<div class="skeleton" style="width:{width};height:{height};border-radius:{radius}"></div>

<style>
	.skeleton {
		background: linear-gradient(
			90deg,
			var(--surface-2) 25%,
			var(--surface-3) 50%,
			var(--surface-2) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes shimmer {
		0% {
			background-position: 200% 0;
		}
		100% {
			background-position: -200% 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.skeleton {
			animation: none;
			background: var(--surface-2);
		}
	}
</style>
