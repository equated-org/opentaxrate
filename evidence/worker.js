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
	// Each copy's URLs and captures, for /sha256/ pages: the same bytes can
	// sit at several URLs (a page that moved), each with rules citing it.
	const byHash = new Map();
	for (const [url, record] of Object.entries(data.urls))
		for (const capture of record.captures) {
			if (!byHash.has(capture.sha256)) byHash.set(capture.sha256, []);
			const at = byHash.get(capture.sha256);
			if (!at.some((a) => a.url === url)) at.push({ url, capture, record });
		}
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
:root { --bg:#fff; --ink:#111; --text-2:#454545; --text-3:#6b6b6b; --line:#e4e4e4; --accent:#2563eb; --mark:#fde68a; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#141414; --ink:#f2f2f2; --text-2:#cfcfcf; --text-3:#a3a3a3; --line:#2c2c2c; --accent:#6ea8fe; --mark:#6b4f12; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 17px/1.65 Inter, ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
a { color: var(--accent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
code, pre, .mono { font-family: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
h1, h2, h3 { font-weight: 600; line-height: 1.3; letter-spacing: -.01em; }
.top, body > main { max-width: 860px; margin: 0 auto; padding: 0 24px; }
.top { display: flex; flex-wrap: wrap; gap: 4px 20px; align-items: baseline; padding-top: 22px; padding-bottom: 14px; border-bottom: 1px solid var(--line); font-size: 15px; }
.top a { white-space: nowrap; }
.top .brand { font-weight: 600; color: var(--ink); text-decoration: none; margin-right: auto; }
.quiet { color: var(--text-3); }
.capture { display: flex; flex-direction: column; }
.capture > .about { order: -1; }
.about { margin: 32px 0 0; padding-bottom: 24px; border-bottom: 1px solid var(--line); font-size: 15px; color: var(--text-2); overflow-wrap: anywhere; }
.about h1 { margin: 0 0 6px; font-size: 19px; }
.about h1 a, .url h1 a { color: var(--ink); text-decoration-color: var(--text-3); }
.about .hash { display: inline-block; max-width: 100%; }
.about p { margin: 4px 0; }
.about h2 { margin: 18px 0 4px; font-size: 15px; color: var(--ink); }
.about ul { margin: 0; padding-left: 18px; }
.about li { margin: 3px 0; }
.about ul.quotes { list-style: none; padding: 0; }
.about ul.quotes > li { margin: 10px 0; }
.badges { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.badge { font: 12px/1.7 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-2); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; white-space: nowrap; }
.badge b { font-weight: 600; color: var(--ink); }
.doc { margin: 8px 0 96px; max-width: 72ch; overflow-wrap: anywhere; }
.doc h1 { font-size: 1.75rem; margin: 1.2em 0 .5em; } .doc h2 { font-size: 1.3rem; margin: 1.6em 0 .4em; } .doc h3, .doc h4 { font-size: 1.05rem; margin: 1.4em 0 .3em; }
.doc ul, .doc ol { padding-left: 22px; }
.doc table { border-collapse: collapse; width: 100%; font-size: 15px; margin: 1.2em 0; display: block; overflow-x: auto; }
.doc th, .doc td { border-bottom: 1px solid var(--line); padding: 6px 12px 6px 0; text-align: left; vertical-align: top; }
.doc th { font-weight: 600; }
.doc img { max-width: 100%; height: auto; }
.doc blockquote { margin: 1em 0; padding-left: 16px; border-left: 2px solid var(--line); color: var(--text-2); }
.doc pre { white-space: pre-wrap; font-size: 13.5px; line-height: 1.55; }
::target-text { background: var(--mark); color: var(--ink); }
.pdf { display: block; width: 100%; height: 88vh; border: 0; margin: 24px 0 64px; }
.list { margin: 40px 0 96px; }
.list h1 { font-size: 2rem; margin: 0 0 12px; }
.list .lede { color: var(--text-2); max-width: 68ch; margin: 0 0 8px; }
.list h2 { font-size: 1.3rem; margin: 48px 0 2px; }
.list h2 + p { margin: 0 0 12px; font-size: 15px; }
.url h1 { font-size: 19px; overflow-wrap: anywhere; }
.list.url ul { padding: 0; max-width: 32em; }
.url p { font-size: 15px; margin: 0 0 12px; }
.list h3 { font-size: 15px; margin: 20px 0 2px; }
.list ul { list-style: none; margin: 0; padding: 0 0 0 16px; font-size: 15px; }
.list li { display: flex; gap: 16px; justify-content: space-between; margin: 2px 0; }
.list li a { overflow-wrap: anywhere; min-width: 0; }
.list li .quiet { white-space: nowrap; font-variant-numeric: tabular-nums; }
.list details { border-top: 1px solid var(--line); font-size: 15px; }
.list details:last-child { border-bottom: 1px solid var(--line); }
.list summary { cursor: pointer; padding: 7px 0; font-weight: 600; }
.list summary .quiet { font-weight: 400; margin-left: 4px; }
.list details ul { padding-bottom: 10px; }
body > main > p { margin: 40px 0; }
`;

function page(title, body, status = 200) {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · OpenTaxRate evidence</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=IBM+Plex+Mono&display=swap">
<style>${STYLE}</style></head><body>
<nav class="top"><a class="brand" href="/">OpenTaxRate evidence archive</a><a href="https://opentaxrate.com/docs/taxability">Taxability docs</a></nav>
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

/** A URL the archive has no copy under: the original, and any copy kept
 *  under another address (an Internet Archive capture, where the site
 *  blocks downloads). */
function notArchived(data, target) {
	const bare = target.replace(/^https?:\/\//, '');
	const elsewhere = Object.keys(data.urls).filter((u) => u !== target && u.endsWith(bare));
	const safe = /^https?:\/\//.test(target);
	return page(
		'Not archived',
		`<div class="url"><h1>${escape(target)}</h1><p>The archive has no copy fetched from this address.${safe ? ` <a href="${escape(target)}" rel="noopener">Open the original</a>.` : ''}</p>${
			elsewhere.length
				? `<p>Copies of it kept under another address:</p><ul>${elsewhere.map((u) => `<li><a href="/url?u=${encodeURIComponent(u)}">${escape(u)}</a></li>`).join('')}</ul>`
				: ''
		}</div>`,
		404,
	);
}

/** A catalog's cited-by entry as { id, tax, code, from, to, quote }. */
function ruleOf(c) {
	if (c.tax) return { ...c, id: `${c.tax}|${c.code}|${c.from}` };
	const m = /^(\S+) (\S+) from (\S+)(?: to (\S+))?$/.exec(c.rule ?? '');
	return m ? { id: c.rule, tax: m[1], code: m[2], from: m[3], to: m[4], quote: c.quote } : { id: c.rule, tax: '', code: c.rule ?? '', from: '', quote: c.quote };
}

/** The header above every capture: where it came from, when, its hash, and
 *  the rules that cite it, each linked to its quote on the page. */
function card(hash, places, shown, asked) {
	const { url, capture, record } = shown;
	const others = record.captures.filter((c) => c.sha256 !== hash);
	const alsoAt = places.filter((p) => p.url !== url);
	// Each quote once, with the rules that cite it as badges; rules citing
	// the page without a quote at the end. The header comes after the
	// document in the page (CSS shows it first), so the browser's text
	// search finds the sentence in the document.
	const cited = places.flatMap((p) => p.record.citedBy).map(ruleOf);
	const byQuote = new Map();
	for (const c of cited) {
		const key = c.quote ?? '';
		if (!byQuote.has(key)) byQuote.set(key, []);
		if (!byQuote.get(key).some((r) => r.id === c.id)) byQuote.get(key).push(c);
	}
	const rules = new Set(cited.map((c) => c.id)).size;
	const opening = (quote) => {
		const words = quote.replace(/\s+/g, ' ').trim().split(' ');
		const shown = words.slice(0, Math.min(12, words.length));
		return escape(shown.join(' ')) + (shown.length < words.length ? ' …' : '');
	};
	const badge = (r) =>
		`<span class="badge" title="${escape(`${r.tax} ${r.code}, from ${r.from}${r.to ? ` to ${r.to}` : ''}`)}"><b>${escape(r.tax)}</b> ${escape(r.code)}</span>`;
	const cites = [...byQuote.entries()]
		.sort(([a], [b]) => (a === '') - (b === ''))
		.map(([quote, rs]) => `<li>${quote ? `<a href="/sha256/${hash}${fragment(quote)}">“${opening(quote)}”</a>` : '<span class="quiet">Cited without a quote</span>'}<div class="badges">${rs.map(badge).join('')}</div></li>`)
		.join('');
	return `<section class="about">
<h1><a href="${escape(url)}" rel="noopener">${escape(url)}</a></h1>
<p>Archived copy, as fetched · captured ${escape(capture.at.replace('T', ' ').slice(0, 16))} UTC · <span class="hash">SHA-256 <span class="mono">${hash}</span></span> · ${escape(capture.type.split(';')[0])}, ${size(capture.bytes)} · <a href="/sha256/${hash}/raw">raw bytes</a></p>
${others.length ? `<p>Other captures: ${others.map((c) => `<a href="/sha256/${c.sha256}">${day(c.at)}</a>`).join(', ')}</p>` : ''}
${alsoAt.length ? `<p>Same bytes at ${alsoAt.map((p) => `<a href="/url?u=${encodeURIComponent(p.url)}">${escape(p.url)}</a>`).join(', ')}</p>` : ''}
${asked ? `<p>Asked for ${escape(asked)}: no copy is from that day or before, so this is the earliest the archive has.</p>` : ''}
<p class="quiet">The original may have changed since.</p>
${rules ? `<h2>Cited by ${rules} rule${rules > 1 ? 's' : ''}</h2><ul class="quotes">${cites}</ul>` : ''}
</section>`;
}

/** The part of a page its site marks as the content (<main>, role="main",
 *  id="main-content"), so a site's menus don't come first; else the whole
 *  page. Every quote the rules cite on an HTML page falls inside it
 *  (checked 2026-10-30, 2,613 quotes). */
function mainPart(html) {
	const lower = html.toLowerCase();
	const main = lower.search(/<main[\s>]/);
	if (main >= 0) {
		const end = lower.lastIndexOf('</main>');
		return html.slice(main, end > main ? end + 7 : html.length);
	}
	const marked = lower.search(/<[a-z]+[^>]*(role="main"|id="main-?content")[^>]*>/);
	if (marked < 0) return html;
	const footer = lower.indexOf('<footer', marked);
	return html.slice(marked, footer > marked ? footer : html.length);
}

/** An archived HTML page's content, in this site's style: no script, style,
 *  site chrome (a page-wide form is unwrapped); links and images pointed at the original site. */
async function readable(object, base) {
	const strip = 'script, style, link, meta, base, object, embed, noscript, iframe, frame, button, input, select, textarea, svg, canvas, header, footer, nav, aside, [role=banner], [role=navigation], [role=contentinfo], [role=search], [aria-hidden=true], .breadcrumb, .breadcrumbs, #breadcrumb, .skip-link, .visually-hidden, .sr-only, [role=menu], [role=menubar], [class*=sidenav], [class*=sidebar], [id*=sidebar], [class*=menu--], [class*=-menu-block], [class*=nav-menu], [class*=megamenu]';
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
	const source = await object.text();
	const title = (source.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? '').replace(/&amp;/g, '&');
	const rewritten = new HTMLRewriter()
		.on(strip, { element: (e) => e.remove() })
		// ASP.NET and SharePoint wrap the whole page in one <form>: unwrap it,
		// keeping the page (its inputs and buttons are stripped above).
		.on('form', { element: (e) => e.removeAndKeepContent() })
		.on('head', { element: (e) => e.remove() })
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
		.transform(new Response(mainPart(source), { headers: { 'content-type': 'text/html; charset=utf-8' } }));
	let html = await rewritten.text();
	html = html.replace(/<!doctype[^>]*>/i, '').replace(/<\/?(html|body)[^>]*>/gi, '');
	return { html, title: title.trim() };
}

/** Text files are shown up to this many bytes, read as a range. */
const TEXT_SHOWN = 200_000;

async function capturePage(env, hash, places, asked) {
	// The URL shown for a copy at several is one a rule cites, if any does.
	const shown = places.find((p) => p.record.citedBy.length) ?? places[0];
	const { url, capture } = shown;
	const type = capture.type.split(';')[0];
	const isText = type.startsWith('text/') && type !== 'text/html';
	const object = await env.EVIDENCE.get(`sha256/${hash}`, isText || type === 'application/json' ? { range: { offset: 0, length: TEXT_SHOWN } } : undefined);
	if (!object) return page('Not found', '<p>That copy isn\'t in the archive.</p>', 404);
	const head = card(hash, places, shown, asked);
	if (type === 'text/html') {
		const { html, title } = await readable(object, url);
		return page(title || url, `<div class="capture"><article class="doc">${html}</article>${head}</div>`);
	}
	if (type === 'application/pdf') return page(url, `<div class="capture"><object class="pdf" data="/sha256/${hash}/raw" type="application/pdf"><p><a href="/sha256/${hash}/raw">Open the PDF</a></p></object>${head}</div>`);
	if (type.startsWith('text/') || type === 'application/json') {
		const text = await object.text();
		const cut = capture.bytes > TEXT_SHOWN;
		return page(url, `<div class="capture"><article class="doc"><pre>${escape(text)}${cut ? `\n\n… the first ${size(TEXT_SHOWN)} of ${size(capture.bytes)}; <a href="/sha256/${hash}/raw">the whole file</a>` : ''}</pre></article>${head}</div>`);
	}
	return page(url, `${head}<p>This file isn't shown here (${escape(type)}); <a href="/sha256/${hash}/raw">download it</a>.</p>`);
}

async function raw(env, hash, capture) {
	const object = await env.EVIDENCE.get(`sha256/${hash}`);
	if (!object) return new Response('Not found', { status: 404 });
	const type = capture?.type ?? object.httpMetadata?.contentType ?? 'application/octet-stream';
	return new Response(object.body, {
		headers: {
			'content-type': type,
			// An archived page's own scripts never run on this site. A PDF is
			// left out: browsers won't show a sandboxed PDF.
			...(type.startsWith('application/pdf') ? {} : { 'content-security-policy': 'sandbox' }),
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
		// Under its site's heading, a page is shown by its path.
		const path = url.replace(/^https?:\/\/[^/]*/, '') || '/';
		return `<li><a href="/sha256/${last.sha256}">${escape(path)}</a>${r.captures.length > 1 ? `<span class="quiet">${r.captures.length} captures</span>` : ''}</li>`;
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
		.map(([host, rows]) => `<h3>${escape(host)}</h3><ul>${rows.sort((a, b) => a[0].localeCompare(b[0])).map(link).join('')}</ul>`)
		.join('');
	const allHtml = group(entries)
		.sort((a, b) => b[1].length - a[1].length)
		.map(
			([host, rows]) =>
				`<details><summary>${escape(host)} <span class="quiet">${rows.length}</span></summary><ul>${rows
					.sort((a, b) => a[0].localeCompare(b[0]))
					.slice(0, 500)
					.map(link)
					.join('')}${rows.length > 500 ? `<li class="quiet">and ${rows.length - 500} more</li>` : ''}</ul></details>`,
		)
		.join('');
	const body = `<div class="list"><h1>Evidence archive</h1>
<p class="lede">Every page and file OpenTaxRate's rates, boundaries and taxability rules were built from, kept as fetched under its SHA-256, with older versions when a page changed. ${entries.length.toLocaleString('en-US')} URLs from ${group(entries).length} sites. Updated ${day(data.generatedAt)}.</p>
<h2>Cited by taxability rules</h2>
<p class="quiet">${cited.length} pages. Each shows the rules that cite it, with links to the quoted sentences.</p>
${citedHtml}
<h2>Every source, by site</h2>
<p class="quiet">Rate files, boundary files and map layers, Census outlines, and the agencies' pages.</p>
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
			const asked = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('asked') ?? '') ? url.searchParams.get('asked') : null;
			if (!found) response = page('Not found', '<p>That hash isn\'t in the archive.</p>', 404);
			else response = m[2] ? await raw(env, m[1], found[0].capture) : await capturePage(env, m[1], found, asked);
		} else if (url.pathname === '/url') {
			const target = url.searchParams.get('u') ?? '';
			const record = data.urls[target];
			response = record
				? page(target, `<div class="list url"><h1><a href="${escape(target)}" rel="noopener">${escape(target)}</a></h1><p class="quiet">${record.captures.length} capture${record.captures.length > 1 ? 's' : ''}, oldest first</p><ul>${record.captures
						.map((c) => `<li><a href="/sha256/${c.sha256}">${escape(c.at.replace('T', ' ').slice(0, 16))} UTC</a><span class="mono quiet">${c.sha256.slice(0, 12)}</span></li>`)
						.join('')}</ul></div>`)
				: notArchived(data, target);
		} else if (/^\/\d{8}\//.test(url.pathname)) {
			const on = `${url.pathname.slice(1, 5)}-${url.pathname.slice(5, 7)}-${url.pathname.slice(7, 9)}T23:59:59Z`;
			const target = url.pathname.slice(10) + url.search;
			const record = data.urls[target];
			const inForce = record?.captures.filter((c) => c.at <= on).at(-1);
			// A day before the first capture gets the earliest copy, which says
			// so, rather than passing it off as the page on that day.
			const capture = inForce ?? record?.captures[0];
			const where = capture && `/sha256/${capture.sha256}${inForce ? '' : `?asked=${on.slice(0, 10)}`}`;
			response = capture ? Response.redirect(new URL(where, url).toString(), 302) : notArchived(data, target);
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
