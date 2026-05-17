import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	test: {
		expect: { requireAssertions: true },
		projects: [
			// Fast unit tests — FakeTransport, in-memory SQLite, no subprocess.
			// Default project; runs on `vitest` / `npm run test:unit`.
			{
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'tests/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'tests/e2e/**',
						'tests/integration/**'
					]
				}
			},
			// Integration tests — spawn scripts/fake-anidb-server.mjs as a
			// child process, exercise real DgramTransport + Session + worker
			// handlers against it. Run via `npm run test:integration` (or
			// `vitest run --project=integration`). Part of `npm run verify`.
			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['tests/integration/**/*.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
