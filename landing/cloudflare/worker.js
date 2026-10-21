/**
 * Serves the static landing build and forwards the two calls it makes, so
 * the browser only ever talks to this origin (no CORS, no keys):
 *   /v1/*      → API_ORIGIN       (the OpenTaxRate API)
 *   /photon/*  → PHOTON_ORIGIN    (a Photon autocomplete)
 * Each visitor IP gets its own budget per minute for each, enforced at the
 * edge before anything reaches the origins.
 */
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		// One canonical host: www and the workers.dev name both go to the apex.
		if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST && url.hostname.endsWith(env.CANONICAL_HOST)) {
			url.hostname = env.CANONICAL_HOST;
			return Response.redirect(url.toString(), 301);
		}
		const route = url.pathname.startsWith('/v1/')
			? { origin: env.API_ORIGIN, path: url.pathname, limiter: env.LOOKUPS }
			: url.pathname.startsWith('/photon/')
				? { origin: env.PHOTON_ORIGIN, path: url.pathname.slice('/photon'.length), limiter: env.SUGGESTIONS }
				: null;
		if (!route) return env.ASSETS.fetch(request);
		if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

		const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
		const { success } = await route.limiter.limit({ key: ip });
		if (!success)
			return Response.json(
				{ error: 'Too many lookups from this address. Try again in 60 s.', code: 'RATE_LIMITED' },
				{ status: 429, headers: { 'Retry-After': '60' } },
			);

		const upstream = new URL(route.path + url.search, route.origin);
		const response = await fetch(upstream, {
			headers: { accept: request.headers.get('accept') ?? '*/*', 'x-forwarded-for': ip },
		});
		const headers = new Headers(response.headers);
		headers.delete('set-cookie');
		return new Response(response.body, { status: response.status, headers });
	},
};
