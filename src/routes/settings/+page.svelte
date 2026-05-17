<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();

	let titlesStatus = $state<string | null>(null);

	async function triggerSync(url: string, setStatus: (s: string | null) => void) {
		setStatus('Syncing…');
		try {
			const r = await fetch(url, { method: 'POST' });
			const j = await r.json();
			setStatus(j.ok ? `Enqueued job #${j.data.job_id}` : 'Failed to enqueue');
		} catch {
			setStatus('Network error');
		}
		setTimeout(() => setStatus(null), 3000);
	}

	const syncTitles = () => triggerSync('/api/sync/titles', (s) => (titlesStatus = s));

	function fmtTs(v: string | null | undefined): string {
		if (!v) return 'Never';
		const n = Number(v);
		if (!Number.isFinite(n) || n <= 0) return 'Never';
		return new Date(n * 1000).toLocaleString();
	}
</script>

<div class="settings">
	<h1>Settings</h1>

	<div class="card">
		<h2>AniDB</h2>
		<dl>
			<div class="row">
				<dt>Client</dt>
				<dd><code>{data.config.client}</code> v{data.config.clientver}</dd>
			</div>
			<div class="row">
				<dt>User configured</dt>
				<dd class:ok={data.config.user_set} class:warn={!data.config.user_set}>
					{data.config.user_set ? 'Yes' : 'No — set ANIDB_USER in .env'}
				</dd>
			</div>
		</dl>
	</div>

	<div class="card">
		<h2>Sync</h2>
		<dl>
			<div class="row">
				<dt>Last titles dump</dt>
				<dd>{fmtTs(data.sync.titles_dump_last_at)}</dd>
			</div>
			<div class="row">
				<dt>Last updated sync</dt>
				<dd>{fmtTs(data.sync.updated_last_run_at)}</dd>
			</div>
		</dl>
		<div class="actions">
			<button class="btn btn-ghost" onclick={syncTitles}>↺ Refresh titles dump</button>
			{#if titlesStatus}
				<span class="sync-status">{titlesStatus}</span>
			{/if}
		</div>
		<p class="hint">Limited to once per 24h (AniDB rule).</p>
	</div>

	<div class="card">
		<h2>Storage</h2>
		<dl>
			<div class="row">
				<dt>Database</dt>
				<dd><code>{data.config.database_path}</code></dd>
			</div>
		</dl>
	</div>
</div>

<style>
	.settings {
		padding: var(--space-6);
		max-width: 560px;
		overflow-y: auto;
		height: 100%;
	}

	h1 {
		font-size: var(--text-xl);
		font-weight: 700;
		color: var(--text);
		margin: 0 0 var(--space-6);
	}

	.card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		padding: var(--space-5);
		margin-bottom: var(--space-4);
	}

	h2 {
		font-size: var(--text-xs);
		font-weight: 700;
		color: var(--text-dim);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0 0 var(--space-4);
	}

	dl {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: var(--space-4);
	}
	dt {
		font-size: var(--text-sm);
		color: var(--text-muted);
		flex-shrink: 0;
	}
	dd {
		font-size: var(--text-sm);
		color: var(--text);
		margin: 0;
		text-align: right;
	}
	dd.ok {
		color: var(--success);
	}
	dd.warn {
		color: var(--warning);
	}

	code {
		background: var(--surface-2);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		color: var(--text);
	}

	.actions {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		margin-top: var(--space-4);
	}

	.sync-status {
		font-size: var(--text-sm);
		color: var(--text-muted);
	}

	.hint {
		font-size: var(--text-xs);
		color: var(--text-dim);
		margin: var(--space-2) 0 0;
	}
</style>
