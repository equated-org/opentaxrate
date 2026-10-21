/**
 * Serves the static landing build and forwards the two calls it makes to the
 * OpenTaxRate API, so the browser only ever talks to this origin:
 *   /v1/*         → the API as is
 *   /photon/api   → the API's /v1/suggest (the page's Photon client asks here)
 * The API is reached through the API binding (a Workers VPC service: a
 * private tunnel, no public hostname) when there is one, else API_ORIGIN.
 * Each visitor IP gets its own budget per minute for each kind of call, and
 * is passed on as X-Client-IP for the API's own per-IP limit, with
 * X-Proxy-Secret (the PROXY_SECRET secret) so the API's front trusts it.
 */
export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		// One canonical host: www goes to the apex.
		if (env.CANONICAL_HOST && url.hostname !== env.CANONICAL_HOST && url.hostname.endsWith(env.CANONICAL_HOST)) {
			url.hostname = env.CANONICAL_HOST;
			return Response.redirect(url.toString(), 301);
		}
		const route = url.pathname.startsWith('/v1/')
			? { path: url.pathname, limiter: env.LOOKUPS }
			: url.pathname === '/photon/api'
				? { path: '/v1/suggest', limiter: env.SUGGESTIONS }
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

		const headers = { accept: request.headers.get('accept') ?? '*/*', 'x-client-ip': ip };
		if (env.PROXY_SECRET) headers['x-proxy-secret'] = env.PROXY_SECRET;
		const init = { headers };
		const response = env.API
			? await env.API.fetch(new Request(`http://api${route.path}${url.search}`, init))
			: await fetch(new URL(route.path + url.search, env.API_ORIGIN), init);
		const out = new Headers(response.headers);
		out.delete('set-cookie');
		return new Response(response.body, { status: response.status, headers: out });
	},
};
