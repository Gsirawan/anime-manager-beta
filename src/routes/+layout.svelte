<script lang="ts">
	import '../app.css';
	import TopBar from '$lib/components/TopBar.svelte';
	let { children } = $props();
</script>

<div class="app">
	<TopBar />
	<main>{@render children()}</main>
</div>

<style>
	.app {
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100vh;
	}
	main {
		overflow: hidden;
	}
</style>
