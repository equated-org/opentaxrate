/**
 * Serves the static landing build and forwards the two calls it makes to the
 * OpenTaxRate API, so the browser only ever talks to this origin:
 *   /v1/*         → the API as is
 *   /photon/api   → the API's /v1/suggest (the page's Photon client asks here)
 *   /api/auth/*, /v1/account/*
 *                 → the API with the method, body and cookies, and its
 *                   Set-Cookie passed back: the dashboard's sign-in and reads,
 *                   on this origin so the session cookie is first-party
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
		const account = url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/v1/account/');
		if (account) return forwardAccount(request, url, env);
		const route = url.pathname.startsWith('/v1/')
			? { path: url.pathname, limiter: env.LOOKUPS }
			: url.pathname === '/photon/api'
				? { path: '/v1/suggest', limiter: env.SUGGESTIONS }
				: null;
		if (!route) return env.ASSETS.fetch(request);
		if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
		// This origin serves the page's own free lookups; a key sent here would
		// be dropped and quietly answered as Free, so say where keys go.
		if (request.headers.has('x-api-key') || request.headers.has('authorization'))
			return Response.json(
				{ error: `Send requests with an API key to ${env.API_ORIGIN ?? 'https://api.opentaxrate.com'}${route.path}.`, code: 'USE_API_HOST' },
				{ status: 400 },
			);

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

/** Sign-in and account calls: per-IP limited, forwarded with what a session
 *  needs and nothing else (no API key is ever passed on). */
async function forwardAccount(request, url, env) {
	if (!['GET', 'POST'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
	const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
	if (env.AUTH && !(await env.AUTH.limit({ key: ip })).success)
		return Response.json({ error: 'Too many requests from this address. Try again in 60 s.', code: 'RATE_LIMITED' }, { status: 429, headers: { 'Retry-After': '60' } });
	const headers = { 'x-client-ip': ip };
	for (const name of ['accept', 'content-type', 'cookie', 'origin', 'user-agent']) {
		const value = request.headers.get(name);
		if (value) headers[name] = value;
	}
	if (env.PROXY_SECRET) headers['x-proxy-secret'] = env.PROXY_SECRET;
	const init = { method: request.method, headers, body: request.method === 'POST' ? await request.arrayBuffer() : undefined };
	const target = url.pathname + url.search;
	const response = env.API ? await env.API.fetch(new Request(`http://api${target}`, init)) : await fetch(new URL(target, env.API_ORIGIN), init);
	const out = new Headers(response.headers);
	out.set('cache-control', 'no-store');
	return new Response(response.body, { status: response.status, headers: out });
}
