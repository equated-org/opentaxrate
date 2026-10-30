/**
 * The public evidence archive at evidence.opentaxrate.com: every page and
 * file OpenTaxRate's data and rules were built from, as fetched, under its
 * SHA-256 (uploaded by `opentaxrate evidence`, src/evidence.ts).
 *
 *   /                          what's archived, by site
 *   /sha256/<hash>             one capture, readable: an HTML page's content in
 *                              this site's style (its scripts, styles and menus
 *                              left out), a PDF in the browser's viewer, any
 *                              other file described; with the original URL, the
 *                              capture's date and hash, and the rules citing it
 *   /sha256/<hash>/raw         the bytes exactly as fetched (HTML sandboxed)
 *   /url?u=<url>               every capture of one URL
 *   /<YYYYMMDD>/<url>          the capture of <url> in force on that day
 *
 * The bytes are the evidence; the readable view is made on each request and
 * cached at the edge, so restyling never touches what was archived. A cited
 * quote is linked as a text fragment (#:~:text=), which the browser finds
 * and highlights.
 */
const CATALOG_TTL_MS = 5 * 60_000;
let cached = null;

async function catalog(env) {
	if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached;
	const object = await env.EVIDENCE.get('catalog.json');
	if (!object) throw new Error('The archive has no catalog yet.');
	const data = await object.json();
	// Each copy's URL and capture, for /sha256/ pages.
	const byHash = new Map();
	for (const [url, record] of Object.entries(data.urls))
		for (const capture of record.captures) if (!byHash.has(capture.sha256)) byHash.set(capture.sha256, { url, capture, record });
	cached = { at: Date.now(), data, byHash };
	return cached;
}

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const day = (iso) => iso.slice(0, 10);
const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} bytes`);
/** A text fragment for a quote: its first words and last words, so a long
 *  sentence still matches. */
function fragment(quote) {
	const words = quote.replace(/\s+/g, ' ').trim().split(' ');
	const enc = (s) => encodeURIComponent(s).replace(/-/g, '%2D');
	return words.length <= 8 ? `#:~:text=${enc(words.join(' '))}` : `#:~:text=${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}`;
}

const STYLE = `
:root { --bg:#faf9f5; --muted:#f0eee6; --surface:#fff; --border:#e8e6dc; --text:#141413; --text-2:#3d3d3a; --text-3:#6b6a63; --accent:#2563eb; --mark:#fde68a; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#1f1e1d; --muted:#262624; --surface:#262624; --border:#34332f; --text:#ecebe6; --text-2:#d3d1c9; --text-3:#a3a197; --accent:#6ea8fe; --mark:#854d0e; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 Inter, ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-underline-offset: 3px; }
code, .mono { font-family: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
.top { border-bottom: 1px solid var(--border); background: var(--surface); }
.top .in, main { max-width: 860px; margin: 0 auto; padding: 0 24px; }
.top .in { display: flex; gap: 12px; align-items: center; height: 52px; font-size: 14px; }
.top .brand { font-weight: 650; color: var(--text); text-decoration: none; letter-spacing: -.01em; }
.top .brand span { color: var(--text-3); font-weight: 450; }
.capture { display: flex; flex-direction: column; }
.capture > .card { order: -1; }
.card { margin: 28px 0 8px; padding: 18px 20px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); font-size: 14px; color: var(--text-2); }
.card h1 { margin: 0 0 6px; font-size: 15px; font-weight: 600; color: var(--text); word-break: break-all; }
.card dl { display: grid; grid-template-columns: 110px 1fr; gap: 4px 14px; margin: 12px 0 0; }
.card dt { color: var(--text-3); }
.card dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.cites { margin: 12px 0 0; padding: 0; list-style: none; display: grid; gap: 8px; }
.cites li { padding: 8px 12px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; }
.doc { margin: 24px 0 80px; color: var(--text); overflow-wrap: anywhere; }
.doc h1, .doc h2, .doc h3, .doc h4 { line-height: 1.3; letter-spacing: -.01em; margin: 1.6em 0 .5em; font-weight: 620; }
.doc h1 { font-size: 1.7rem; } .doc h2 { font-size: 1.3rem; } .doc h3 { font-size: 1.1rem; }
.doc table { border-collapse: collapse; width: 100%; font-size: 14px; margin: 1em 0; display: block; overflow-x: auto; }
.doc th, .doc td { border: 1px solid var(--border); padding: 6px 10px; text-align: left; vertical-align: top; }
.doc th { background: var(--muted); font-weight: 600; }
.doc img { max-width: 100%; height: auto; }
.doc blockquote { margin: 1em 0; padding: 0 16px; border-left: 3px solid var(--border); color: var(--text-2); }
.doc pre { white-space: pre-wrap; background: var(--muted); padding: 12px; border-radius: 8px; }
::target-text { background: var(--mark); color: var(--text); }
.pdf { width: 100%; height: 85vh; border: 1px solid var(--border); border-radius: 12px; margin: 16px 0 60px; background: var(--surface); }
.list { margin: 20px 0 80px; }
.list h2 { font-size: 1.15rem; margin: 36px 0 6px; }
.list h3 { font-size: 14px; margin: 18px 0 4px; }
.list details { border-top: 1px solid var(--border); padding: 8px 0; font-size: 14px; }
.list summary { cursor: pointer; font-weight: 600; }
.list ul { margin: 0; padding-left: 18px; font-size: 14px; }
.list li { margin: 3px 0; overflow-wrap: anywhere; }
.muted { color: var(--text-3); }
.lede { color: var(--text-2); font-size: 15px; max-width: 64ch; }
`;

function page(title, body, status = 200) {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · OpenTaxRate evidence</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=Geist+Mono&display=swap">
<style>${STYLE}</style></head><body>
<div class="top"><div class="in"><a class="brand" href="/">OpenTaxRate <span>evidence archive</span></a><span class="muted">·</span><a href="https://opentaxrate.com/docs/taxability">Taxability docs</a></div></div>
<main>${body}</main></body></html>`,
		{ status, headers: { 'content-type': 'text/html; charset=utf-8', ...SECURITY } },
	);
}

// The readable view runs no script; fonts and images may load from elsewhere.
const SECURITY = {
	'content-security-policy':
		"default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src * data:; object-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'",
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'no-referrer',
};

/** The card above every capture: where it came from, when, its hash, and
 *  the rules that cite it, each linked to its quote on the page. */
function card(hash, url, capture, record) {
	const others = record.captures.filter((c) => c.sha256 !== hash);
	// Quotes grouped by the rule citing them, shown by their first words.
	// The card comes after the document in the page (CSS shows it first),
	// so the browser's text search finds the sentence in the document.
	const byRule = new Map();
	for (const c of record.citedBy) {
		if (!byRule.has(c.rule)) byRule.set(c.rule, []);
		if (c.quote) byRule.get(c.rule).push(c.quote);
	}
	const opening = (quote) => {
		const words = quote.replace(/\s+/g, ' ').trim().split(' ');
		const shown = words.slice(0, Math.min(8, words.length));
		return escape(shown.join(' ')) + (shown.length < words.length ? ' …' : '');
	};
	const cites = byRule.size
		? `<ul class="cites">${[...byRule.entries()]
				.map(
					([rule, quotes]) =>
						`<li><strong>${escape(rule)}</strong>${quotes.map((q) => `<br><a href="/sha256/${hash}${fragment(q)}">“${opening(q)}”</a>`).join('')}</li>`,
				)
				.join('')}</ul>`
		: '';
	return `<section class="card">
<h1><a href="${escape(url)}" rel="noopener">${escape(url)}</a> ↗</h1>
<div>A copy archived by OpenTaxRate, as fetched; the original is linked above and may have changed since.</div>
<dl>
<dt>Captured</dt><dd>${escape(capture.at.replace('T', ' ').slice(0, 16))} UTC</dd>
<dt>SHA-256</dt><dd class="mono">${hash}</dd>
<dt>File</dt><dd>${escape(capture.type.split(';')[0])}, ${size(capture.bytes)} · <a href="/sha256/${hash}/raw">raw bytes</a></dd>
${others.length ? `<dt>Other captures</dt><dd>${others.map((c) => `<a href="/sha256/${c.sha256}">${day(c.at)}</a>`).join(', ')}</dd>` : ''}
${byRule.size ? `<dt>Cited by</dt><dd>${byRule.size} rule${byRule.size > 1 ? 's' : ''}; each quote links to its sentence below</dd>` : ''}
</dl>${cites}</section>`;
}

/** An archived HTML page's content, in this site's style: no script, style,
 *  form or site chrome; links and images pointed at the original site. */
async function readable(object, base) {
	const strip = 'script, style, link, noscript, iframe, frame, form, button, input, select, textarea, svg, canvas, header, footer, nav, aside, [role=banner], [role=navigation], [role=contentinfo], [role=search], [aria-hidden=true], .breadcrumb, .breadcrumbs, #breadcrumb, .skip-link, .visually-hidden, .sr-only';
	const absolute = (attr) => ({
		element(e) {
			const v = e.getAttribute(attr);
			if (!v) return;
			try {
				const u = new URL(v, base);
				if (u.protocol === 'javascript:') e.removeAttribute(attr);
				else e.setAttribute(attr, u.toString());
			} catch {
				e.removeAttribute(attr);
			}
		},
	});
	let title = '';
	const rewritten = new HTMLRewriter()
		.on(strip, { element: (e) => e.remove() })
		.on('head', { element: (e) => e.remove() })
		.on('title', { text: (t) => { title += t.text; } })
		.on('*', {
			element(e) {
				// Event handlers never run; the page's own classes and inline
				// styles would fight this site's.
				for (const [name] of [...e.attributes]) if (/^on/i.test(name) || name === 'style' || name === 'class') e.removeAttribute(name);
			},
		})
		.on('a[href]', absolute('href'))
		.on('img[src]', absolute('src'))
		.on('img[srcset]', { element: (e) => e.removeAttribute('srcset') })
		.transform(new Response(object.body, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
	let html = await rewritten.text();
	html = html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?(html|body)[^>]*>/gi, '');
	return { html, title: title.trim() };
}

async function capturePage(env, hash, url, capture, record) {
	const object = await env.EVIDENCE.get(`sha256/${hash}`);
	if (!object) return page('Not found', '<p>That copy isn\'t in the archive.</p>', 404);
	const type = capture.type.split(';')[0];
	const head = card(hash, url, capture, record);
	if (type === 'text/html') {
		const { html, title } = await readable(object, url);
		return page(title || url, `<div class="capture"><article class="doc">${html}</article>${head}</div>`);
	}
	if (type === 'application/pdf') return page(url, `<div class="capture"><object class="pdf" data="/sha256/${hash}/raw" type="application/pdf"><p><a href="/sha256/${hash}/raw">Open the PDF</a></p></object>${head}</div>`);
	if (type.startsWith('text/') || type === 'application/json') {
		const text = (await object.text()).slice(0, 200_000);
		return page(url, `<div class="capture"><article class="doc"><pre>${escape(text)}${text.length === 200_000 ? '\n…' : ''}</pre></article>${head}</div>`);
	}
	return page(url, `${head}<p class="lede">This file isn't shown here (${escape(type)}); <a href="/sha256/${hash}/raw">download it</a>.</p>`);
}

async function raw(env, hash, capture) {
	const object = await env.EVIDENCE.get(`sha256/${hash}`);
	if (!object) return new Response('Not found', { status: 404 });
	const type = capture?.type ?? object.httpMetadata?.contentType ?? 'application/octet-stream';
	return new Response(object.body, {
		headers: {
			'content-type': type,
			// An archived page's own scripts never run on this site.
			'content-security-policy': 'sandbox',
			'x-content-type-options': 'nosniff',
			'cache-control': 'public, max-age=31536000, immutable',
			etag: `"${hash}"`,
		},
	});
}

function index(data) {
	const entries = Object.entries(data.urls);
	const link = ([url, r]) => {
		const last = r.captures.at(-1);
		return `<li><a href="/sha256/${last.sha256}">${escape(url.replace(/^https?:\/\//, ''))}</a> <span class="muted">${day(last.at)}${r.captures.length > 1 ? ` · ${r.captures.length} captures` : ''}</span></li>`;
	};
	// The pages taxability rules cite, by site; then everything else.
	const cited = entries.filter(([, r]) => r.citedBy.length);
	const group = (rows) => {
		const byHost = new Map();
		for (const row of rows) {
			const host = new URL(row[0]).host;
			if (!byHost.has(host)) byHost.set(host, []);
			byHost.get(host).push(row);
		}
		return [...byHost.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	};
	const citedHtml = group(cited)
		.map(([host, rows]) => `<h3>${escape(host)} <span class="muted">· ${rows.length}</span></h3><ul>${rows.sort((a, b) => a[0].localeCompare(b[0])).map(link).join('')}</ul>`)
		.join('');
	const allHtml = group(entries)
		.sort((a, b) => b[1].length - a[1].length)
		.map(
			([host, rows]) =>
				`<details><summary>${escape(host)} <span class="muted">· ${rows.length}</span></summary><ul>${rows
					.sort((a, b) => a[0].localeCompare(b[0]))
					.slice(0, 500)
					.map(link)
					.join('')}${rows.length > 500 ? `<li class="muted">and ${rows.length - 500} more</li>` : ''}</ul></details>`,
		)
		.join('');
	const body = `<div class="list"><h1 style="font-size:1.7rem;margin:32px 0 8px">Evidence archive</h1>
<p class="lede">Every page and file OpenTaxRate's rates, boundaries and taxability rules were built from, kept as fetched under its SHA-256, with older versions when a page changed. ${entries.length.toLocaleString('en-US')} URLs from ${group(entries).length} sites. Updated ${day(data.generatedAt)}.</p>
<h2>Cited by taxability rules <span class="muted">· ${cited.length} pages</span></h2>
<p class="muted" style="font-size:14px;margin:0">Each page shows the rules that cite it, with links to the quoted sentences.</p>
${citedHtml}
<h2>Every source, by site</h2>
<p class="muted" style="font-size:14px;margin:0">Rate files, boundary files and map layers, Census outlines, and the agencies' pages.</p>
${allHtml}</div>`;
	return page('Evidence archive', body);
}

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
		const edge = caches.default;
		const hit = await edge.match(request);
		if (hit) return hit;
		const { data, byHash } = await catalog(env);
		let response;
		const m = url.pathname.match(/^\/sha256\/([0-9a-f]{64})(\/raw)?$/);
		if (m) {
			const found = byHash.get(m[1]);
			if (!found) response = page('Not found', '<p>That hash isn\'t in the archive.</p>', 404);
			else response = m[2] ? await raw(env, m[1], found.capture) : await capturePage(env, m[1], found.url, found.capture, found.record);
		} else if (url.pathname === '/url') {
			const target = url.searchParams.get('u') ?? '';
			const record = data.urls[target];
			response = record
				? page(target, `<div class="list"><h1 style="font-size:1.3rem;margin:32px 0 8px;word-break:break-all">${escape(target)}</h1><ul>${record.captures
						.map((c) => `<li><a href="/sha256/${c.sha256}">${escape(c.at.replace('T', ' ').slice(0, 16))} UTC</a> <span class="mono muted">${c.sha256.slice(0, 12)}</span></li>`)
						.join('')}</ul></div>`)
				: page('Not archived', `<p>${escape(target)} isn't in the archive.</p>`, 404);
		} else if (/^\/\d{8}\//.test(url.pathname)) {
			const on = `${url.pathname.slice(1, 5)}-${url.pathname.slice(5, 7)}-${url.pathname.slice(7, 9)}T23:59:59Z`;
			const target = url.pathname.slice(10) + url.search;
			const record = data.urls[target];
			const capture = record?.captures.filter((c) => c.at <= on).at(-1) ?? record?.captures[0];
			response = capture ? Response.redirect(new URL(`/sha256/${capture.sha256}`, url).toString(), 302) : page('Not archived', `<p>${escape(target)} isn't in the archive.</p>`, 404);
		} else if (url.pathname === '/') response = index(data);
		else response = page('Not found', '<p>Nothing here. <a href="/">The archive</a>.</p>', 404);
		if (response.status === 200 && request.method === 'GET') {
			response = new Response(response.body, response);
			if (!response.headers.has('cache-control')) response.headers.set('cache-control', 'public, max-age=300');
			ctx.waitUntil(edge.put(request, response.clone()));
		}
		return response;
	},
};
