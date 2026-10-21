import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), '');
	return {
		plugins: [tailwindcss(), sveltekit()],
		// PUBLIC_* settings are baked into the static build (import.meta.env), so
		// set them in the host's build environment, not at runtime.
		envPrefix: ['PUBLIC_'],
		// Pre-bundled up front, so the first result doesn't reload the dev page.
		optimizeDeps: { include: ['maplibre-gl'] },
		server: {
			// Reachable from other machines (e.g. over Tailscale), not just localhost.
			host: true,
			// Dev only: with PUBLIC_API_URL empty, /v1/* is forwarded to a local
			// API, which sidesteps CORS on an API that doesn't send it yet.
			proxy: {
				'/v1': env.API_PROXY_TARGET || 'http://localhost:8080',
				// Dev only: PUBLIC_PHOTON_URL=/photon reaches a Photon that sends no
				// CORS headers (a self-hosted one without -cors-any).
				'/photon': {
					target: env.PHOTON_PROXY_TARGET || 'https://photon.komoot.io',
					changeOrigin: true,
					rewrite: (path) => path.replace(/^\/photon/, '')
				}
			}
		}
	};
});
