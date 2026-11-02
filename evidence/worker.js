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
 *   /sha256/<hash>?view=text   a document's text as the quote checks read it
 *                              (a PDF's and a Word document's by default; a
 *                              web page's beside its readable view), each
 *                              cited quote highlighted under its anchor #q-…;
 *                              with &full=1, a web page's whole text, its
 *                              site's navigation included
 *   /sha256/<hash>?view=       a PDF's other views: layout (as printed) and
 *                              formatted (machine-made Markdown of table pages)
 *   /sha256/<hash>/raw         the bytes exactly as fetched (HTML sandboxed)
 *   /url?u=<url>               every capture of one URL
 *   /<YYYYMMDD>/<url>          the capture of <url> in force on that day
 *
 * The bytes are the evidence; the readable view is made on each request and
 * cached at the edge, so restyling never touches what was archived. A cited
 * quote is linked to its mark in the text view (?view=text#q-…): the place
 * was found when the archive was uploaded, by the matcher the quote checks
 * use (src/evidence-text.ts), so the link opens at it whatever the page's
 * markup or punctuation. A quote a copy has no mark for is linked as a text
 * fragment (#:~:text=). The quotes printed in a capture's own header are
 * drawn by CSS, so a browser's text search never lands on them.
 *
 * A cited original that's gone (the site's offline-originals.json, written by
 * scripts/check-links.mts) is named but not linked, and said to be gone.
 */
import offlineList from '../client/src/lib/offline-originals.json';

const offline = (url) => Object.hasOwn(offlineList.urls, url);
/** An original page's address: a link, or, when it's gone, plain text that says so. */
const original = (url, text = escape(url)) =>
	offline(url) ? `<span title="Gone when checked on ${escape(offlineList.checked)}">${text}</span>` : `<a href="${escape(url)}" rel="noopener">${text}</a>`;

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
:root { --bg:#fff; --ink:#111; --text-2:#454545; --text-3:#6b6b6b; --line:#e4e4e4; --accent:#2563eb; --mark:#fde68a; --quote:#fde68a; --quote-line:#b45309; --warn-bg:#fff7e6; --warn-line:#d97706; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg:#141414; --ink:#f2f2f2; --text-2:#cfcfcf; --text-3:#a3a3a3; --line:#2c2c2c; --accent:#6ea8fe; --mark:#6b4f12; --quote:#5c4a12; --quote-line:#f0b429; --warn-bg:#2a2012; --warn-line:#b7791f; color-scheme: dark; } }
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
p.bad-capture { background: var(--warn-bg); border-left: 3px solid var(--warn-line); padding: 6px 10px; }
.badges { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; }
.badge { font: 12px/1.7 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-2); border: 1px solid var(--line); border-radius: 4px; padding: 0 6px; white-space: nowrap; }
.badge b { font-weight: 600; color: var(--ink); }
.doc { margin: 8px 0 96px; max-width: 72ch; overflow-wrap: anywhere; }
.pdf-note { font-size: 14px; color: var(--text-3); margin: 18px 0 8px; }
.pdf-text pre { white-space: pre-wrap; font: 15px/1.6 Inter, ui-sans-serif, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; margin: 0; }
.pdf-page { border-top: 1px solid var(--line); padding: 12px 0 20px; }
.pdf-paras p { margin: 0 0 .7em; }
.views { font-size: 14px; margin: 18px 0 0; color: var(--text-3); }
.views [aria-current] { color: var(--ink); font-weight: 600; }
.doc.wide { max-width: none; }
.pdf-text pre.layout { white-space: pre; overflow-x: auto; font: 12.5px/1.45 "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.machine-note { margin: 18px 0 12px; padding: 10px 14px; border: 1px solid var(--warn-line); border-left: 4px solid var(--warn-line); background: var(--warn-bg); border-radius: 4px; font-size: 15px; }
.machine-note p { margin: 4px 0; }
.machine-label { margin: 0 0 8px; font-size: 13px; color: var(--text-2); padding: 2px 8px; border-left: 3px solid var(--warn-line); background: var(--warn-bg); }
mark.disagree { background: var(--mark); color: var(--ink); border-bottom: 2px solid var(--warn-line); }
.alt { font-size: .82em; color: var(--text-2); margin: 0 2px; }
.doc .formatted table { font-size: 14px; }
.doc .formatted th, .doc .formatted td { padding: 4px 10px 4px 0; }
.doc .formatted h3, .doc .formatted h4, .doc .formatted h5 { font-size: 1rem; margin: 1em 0 .3em; }
.doc .formatted p { margin: .4em 0; }
.page-no { margin: 0 0 6px; font-size: 13px; }
.doc h1 { font-size: 1.75rem; margin: 1.2em 0 .5em; } .doc h2 { font-size: 1.3rem; margin: 1.6em 0 .4em; } .doc h3, .doc h4 { font-size: 1.05rem; margin: 1.4em 0 .3em; }
.doc ul, .doc ol { padding-left: 22px; }
.doc table { border-collapse: collapse; width: 100%; font-size: 15px; margin: 1.2em 0; display: block; overflow-x: auto; }
.doc th, .doc td { border-bottom: 1px solid var(--line); padding: 6px 12px 6px 0; text-align: left; vertical-align: top; }
.doc th { font-weight: 600; }
.doc img { max-width: 100%; height: auto; }
.doc blockquote { margin: 1em 0; padding-left: 16px; border-left: 2px solid var(--line); color: var(--text-2); }
.doc pre { white-space: pre-wrap; font-size: 13.5px; line-height: 1.55; }
::target-text { background: var(--mark); color: var(--ink); }
mark.q { background: var(--quote); color: var(--ink); border-radius: 2px; box-shadow: 0 0 0 2px var(--quote); scroll-margin-top: 30vh; }
mark.q:target, mark.q:has(:target) { outline: 2px solid var(--quote-line); outline-offset: 2px; }
.q-at { scroll-margin-top: 30vh; }
.about a.cite span[data-q]::before { content: attr(data-q); }
.text-lines p { margin: 0 0 .45em; }
.crop-note { font-size: 14px; color: var(--text-3); margin: 0 0 14px; }
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

// Fonts are display=optional: a font that arrives late is never swapped in,
// so the page doesn't reflow after the browser has scrolled to a #q- mark.
function page(title, body, status = 200) {
	return new Response(
		`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · OpenTaxRate evidence</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..700&family=IBM+Plex+Mono&display=optional">
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
		`<div class="url"><h1>${escape(target)}</h1><p>The archive has no copy fetched from this address.${safe ? ` ${offline(target) ? 'The original is no longer online either.' : `<a href="${escape(target)}" rel="noopener">Open the original</a>.`}` : ''}</p>${
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

/** What a known-bad capture (KNOWN-BAD.md: an error answer, a refused
 *  download, a fragment) is, said where it's shown: never passed off as the
 *  page. Empty for a good capture. */
const badNote = (capture) => (capture.bad ? `${capture.bad[0].toUpperCase()}${capture.bad.slice(1)} — not the page` : '');

/** The capture to show for a day: the last good one on or before it; else
 *  the earliest good one (saying no copy of the page is from that day or
 *  before); else, when every capture is bad, the last on or before it, or
 *  the earliest. `early` is true when the capture is from after the day. */
function captureOn(captures, on) {
	for (const list of [captures.filter((c) => !c.bad), captures]) {
		const before = list.filter((c) => c.at <= on).at(-1);
		if (before) return { capture: before, early: false };
		if (list.length) return { capture: list[0], early: true };
	}
	return null;
}

/** The header above every capture: where it came from, when, its hash, and
 *  the rules that cite it, each linked to its quote on the page. */
function card(hash, places, shown, asked, marks = []) {
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
		return shown.join(' ') + (shown.length < words.length ? ' …' : '');
	};
	const badge = (r) =>
		`<span class="badge" title="${escape(`${r.tax} ${r.code}, from ${r.from}${r.to ? ` to ${r.to}` : ''}`)}"><b>${escape(r.tax)}</b> ${escape(r.code)}</span>`;
	// Each quote links to its mark in this copy's text view; one this copy has
	// no mark for, to a text fragment. The quote is drawn by CSS (an empty
	// span's ::before; the link is named by aria-label), so no text search,
	// the browser's or a text fragment's, finds it here instead of in the
	// document.
	const markOf = new Map(marks.map((m) => [m.quote, m.id]));
	const quoteLink = (quote) => {
		const id = markOf.get(quote);
		const label = escape(`“${opening(quote)}”`);
		return `<a class="cite" href="/sha256/${hash}${id ? `?view=text#${id}` : fragment(quote)}" aria-label="${label}"><span data-q="${label}"></span></a>`;
	};
	const cites = [...byQuote.entries()]
		.sort(([a], [b]) => (a === '') - (b === ''))
		.map(([quote, rs]) => `<li>${quote ? quoteLink(quote) : '<span class="quiet">Cited without a quote</span>'}<div class="badges">${rs.map(badge).join('')}</div></li>`)
		.join('');
	return `<section class="about">
<h1>${original(url)}</h1>
${capture.via ? `<p>Copied from the <a href="${escape(capture.via)}" rel="noopener">Internet Archive's capture</a> of ${escape(day(capture.at))}: the site blocks downloads, or this edition is no longer online.</p>` : ''}
${capture.bad ? `<p class="bad-capture"><strong>${escape(badNote(capture))}</strong>: this capture is kept as fetched, but it isn't evidence of the page. ${others.some((c) => !c.bad) ? 'See the other captures below.' : 'The archive has no other capture that is the page.'}</p>` : ''}
<p>Archived copy, as fetched · captured ${escape(capture.at.replace('T', ' ').slice(0, 16))} UTC · <span class="hash">SHA-256 <span class="mono">${hash}</span></span> · ${escape(capture.type.split(';')[0])}, ${size(capture.bytes)} · <a href="/sha256/${hash}/raw">raw bytes</a></p>
${others.length ? `<p>Other captures: ${others.map((c) => `<a href="/sha256/${c.sha256}">${day(c.at)}</a>${c.bad ? ` <span class="bad-capture">(${escape(badNote(c))})</span>` : ''}`).join(', ')}</p>` : ''}
${alsoAt.length ? `<p>Same bytes at ${alsoAt.map((p) => `<a href="/url?u=${encodeURIComponent(p.url)}">${escape(p.url)}</a>`).join(', ')}</p>` : ''}
${asked ? `<p>Asked for ${escape(asked)}: no copy of the page is from that day or before, so this is the earliest the archive has.</p>` : ''}
<p class="quiet">${offline(url) ? `The original is no longer online (checked ${escape(offlineList.checked)}); this copy is the evidence.` : 'The original may have changed since.'}</p>
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

/** The views a capture offers, the one shown named, the others linked. */
const viewToggle = (offered, view, href) =>
	offered.length > 1 ? `<p class="views">${offered.map((v) => (v === view ? `<span aria-current="page">${VIEWS[v]}</span>` : `<a href="${href(v)}">${VIEWS[v]}</a>`)).join(' · ')}</p>` : '';

async function capturePage(env, hash, places, asked, view, full) {
	// The URL shown for a copy at several is one a rule cites, if any does.
	const shown = places.find((p) => p.record.citedBy.length) ?? places[0];
	const { url, capture } = shown;
	const type = capture.type.split(';')[0];
	const isText = type.startsWith('text/') && type !== 'text/html';
	if (type === 'application/pdf' || type === 'application/msword') return pdfPage(env, hash, url, (marks) => card(hash, places, shown, asked, marks), view);
	// A web page's text (a text file's, or an API's JSON answer's, where a
	// rule quotes it), with its marks: the text view, and the header's links.
	const textObject = /^(text\/|application\/(json|xml))/.test(type) ? await env.EVIDENCE.get(`text/${hash}.json`) : null;
	const text = textObject ? await textObject.json() : null;
	const hasText = Array.isArray(text?.pages);
	const head = card(hash, places, shown, asked, text?.marks ?? []);
	const toggle = hasText ? viewToggle(['page', 'text'], view === 'text' ? 'text' : 'page', (v) => `/sha256/${hash}${v === 'text' ? '?view=text' : ''}`) : '';
	if (view === 'text' && hasText) return webTextPage(hash, url, head, text, full, toggle);
	const object = await env.EVIDENCE.get(`sha256/${hash}`, isText || type === 'application/json' ? { range: { offset: 0, length: TEXT_SHOWN } } : undefined);
	if (!object) return page('Not found', '<p>That copy isn\'t in the archive.</p>', 404);
	if (type === 'text/html') {
		const { html, title } = await readable(object, url);
		return page(title || url, `<div class="capture"><article class="doc">${toggle}${html}</article>${head}</div>`);
	}
	if (type.startsWith('text/') || type === 'application/json') {
		const body = await object.text();
		const cut = capture.bytes > TEXT_SHOWN;
		return page(url, `<div class="capture"><article class="doc">${toggle}<pre>${escape(body)}${cut ? `\n\n… the first ${size(TEXT_SHOWN)} of ${size(capture.bytes)}; <a href="/sha256/${hash}/raw">the whole file</a>` : ''}</pre></article>${head}</div>`);
	}
	return page(url, `${head}<p>This file isn't shown here (${escape(type)}); <a href="/sha256/${hash}/raw">download it</a>.</p>`);
}

/** A model's short name: "gemini-3.1-flash-lite" for "google/gemini-3.1-flash-lite". */
const modelName = (id) => String(id).split('/').pop();

/** A tiny Markdown renderer for machine-formatted pages: headings, tables,
 *  lists, paragraphs and **bold**, nothing else. Every character is escaped
 *  first, so no HTML in the Markdown reaches the page as HTML. */
function markdown(md) {
	const inline = (s) => escape(s).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	const cells = (line) => {
		let t = line.trim();
		if (t.startsWith('|')) t = t.slice(1);
		if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1);
		return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
	};
	const rule = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
	const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
	const out = [];
	for (let i = 0; i < lines.length; ) {
		const line = lines[i];
		if (!line.trim()) {
			i++;
			continue;
		}
		const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (heading) {
			out.push(`<h${Math.min(heading[1].length + 2, 5)}>${inline(heading[2])}</h${Math.min(heading[1].length + 2, 5)}>`);
			i++;
			continue;
		}
		if (/^\s*\|/.test(line)) {
			const rows = [];
			while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(lines[i++]);
			const headed = rows.length > 1 && rule(rows[1]);
			const body = rows.filter((r, k) => !(headed && k === 1) && !rule(r));
			const row = (r, tag) => `<tr>${cells(r).map((c) => `<${tag}>${inline(c)}</${tag}>`).join('')}</tr>`;
			out.push(`<table>${headed ? `<thead>${row(body[0], 'th')}</thead>` : ''}<tbody>${(headed ? body.slice(1) : body).map((r) => row(r, 'td')).join('')}</tbody></table>`);
			continue;
		}
		const item = /^\s*([-*+]|\d+[.)])\s+/;
		if (item.test(line)) {
			const ordered = /^\s*\d/.test(line);
			const items = [];
			while (i < lines.length && item.test(lines[i]) && /^\s*\d/.test(lines[i]) === ordered) items.push(lines[i++].replace(item, ''));
			out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
			continue;
		}
		const para = [];
		while (i < lines.length && lines[i].trim() && !/^\s*(\||#{1,6}\s)/.test(lines[i]) && !item.test(lines[i])) para.push(lines[i++]);
		out.push(`<p>${para.map(inline).join('<br>')}</p>`);
	}
	return out.join('\n');
}

/** A scan's machine transcription of one page, each place the two models
 *  read differently marked, with the other reading beside it. */
function transcribed(page, other) {
	const text = page.text ?? '';
	const places = [...(page.disagreements ?? [])].filter((d) => d.start >= 0 && d.end <= text.length && d.start <= d.end).sort((x, y) => x.start - y.start);
	let html = '';
	let at = 0;
	for (const d of places) {
		if (d.start < at) continue;
		html += escape(text.slice(at, d.start));
		const reading = d.b ? `${escape(other)} reads “${escape(d.b)}”` : `${escape(other)} has nothing here`;
		html +=
			d.start < d.end
				? `<mark class="disagree">${escape(text.slice(d.start, d.end))}</mark><span class="alt">[${reading}]</span>`
				: `<span class="alt">[${escape(other)} adds “${escape(d.b)}”]</span>`;
		at = d.end;
	}
	return html + escape(text.slice(at));
}

const VIEWS = { page: 'Page', text: 'Text', layout: 'Layout (columns and tables as printed)', formatted: 'Formatted (machine, unverified)' };

/** Pieces of the marks on one page of a text: [start, end) in the page's
 *  text, with the mark's id on the piece it starts in (a quote running over
 *  a page break goes on, without its id, at the next page's start). */
function marksOnPage(marks, pages, i) {
	const out = [];
	for (const m of marks ?? []) {
		const length = pages[m.page - 1]?.length ?? 0;
		if (m.page === i + 1) out.push({ start: m.start, end: Math.min(m.end, length), id: m.id });
		else if (m.page === i && m.end > length + 1) out.push({ start: 0, end: m.end - length - 1, id: null });
	}
	return out;
}

/**
 * A text as HTML, every character escaped, with each mark's span as one
 * <mark class="q" id="q-…">. `mode` "paras" (a PDF's or a Word document's
 * text) joins lines into paragraphs and keeps blank lines as breaks;
 * "lines" (a web page's text, one block a line) makes each line a
 * paragraph. A mark never breaks: a paragraph or line break inside one is
 * drawn inside it as a line break (<br>). Marks that overlap are drawn as one,
 * each later one's anchor an empty span where it starts.
 */
function renderText(text, marks, mode) {
	// Marks merged where they overlap, in order.
	const sorted = [...marks].filter((m) => m.end > m.start).sort((a, b) => a.start - b.start || b.end - a.end);
	const groups = [];
	for (const m of sorted) {
		const last = groups.at(-1);
		if (last && m.start < last.end) {
			last.end = Math.max(last.end, m.end);
			if (m.id) last.anchors.push(m);
		} else groups.push({ start: m.start, end: m.end, id: m.id, anchors: [] });
	}
	// Breaks: each run of whitespace with a line break in it.
	const breaks = [];
	for (const b of text.matchAll(/\s*\n\s*/g)) {
		const newlines = b[0].split('\n').length - 1;
		breaks.push({ start: b.index, end: b.index + b[0].length, kind: mode === 'lines' ? 'line' : newlines >= 2 ? 'para' : 'join' });
	}
	// A mark's ends are on text, never inside a break.
	for (const g of groups)
		for (const b of breaks) {
			if (g.start >= b.start && g.start < b.end) g.start = b.end;
			if (g.end > b.start && g.end <= b.end) g.end = b.start;
		}
	const events = [];
	for (const g of groups) {
		if (g.end <= g.start) continue;
		events.push({ at: g.start, order: 1, html: `<mark class="q"${g.id ? ` id="${escape(g.id)}"` : ''}>` });
		for (const a of g.anchors) events.push({ at: Math.max(a.start, g.start), order: 2, html: `<span class="q-at" id="${escape(a.id)}"></span>` });
		events.push({ at: g.end, order: 0, html: '</mark>' });
	}
	events.sort((a, b) => a.at - b.at || a.order - b.order);
	const paras = [];
	let current = '';
	let inMark = false;
	let e = 0;
	// The text from `from` to `to`, with the marks that open or close in it.
	const run = (from, to) => {
		let at = from;
		// A mark that closes where the text breaks closes before the break.
		while (e < events.length && (events[e].at < to || (events[e].at === to && (events[e].order === 0 || to === text.length)))) {
			const ev = events[e++];
			current += escape(text.slice(at, Math.max(at, ev.at))) + ev.html;
			at = Math.max(at, ev.at);
			if (ev.order === 1) inMark = true;
			else if (ev.order === 0) inMark = false;
		}
		current += escape(text.slice(at, to));
	};
	let pos = 0;
	for (const b of breaks) {
		run(pos, b.start);
		if (b.kind === 'join') current += ' ';
		// Inside a mark a break is a line break (a blank line there would
		// draw an empty highlighted box).
		else if (inMark) current += '<br>';
		else {
			if (current.trim()) paras.push(current);
			current = '';
		}
		pos = b.end;
	}
	run(pos, text.length);
	if (inMark) current += '</mark>';
	if (current.trim()) paras.push(current);
	return paras;
}

/** One page of a text as paragraphs, its marks drawn. */
const textHtml = (text, marks, mode) => {
	const paras = renderText(text, marks, mode);
	return paras.length ? `<div class="pdf-paras${mode === 'lines' ? ' text-lines' : ''}">${paras.map((x) => `<p>${x}</p>`).join('')}</div>` : '<p class="quiet">(no text on this page)</p>';
};

/** Where a web page's crop (the lines a model picked as its main content)
 *  runs in its text, when it holds every mark: only then is it shown. */
function cropOf(text) {
	if (!text?.crop || text.kind !== 'html') return null;
	const page = text.pages[0] ?? '';
	const starts = [0];
	for (let i = page.indexOf('\n'); i >= 0; i = page.indexOf('\n', i + 1)) starts.push(i + 1);
	const { firstLine, lastLine } = text.crop;
	if (!(firstLine >= 1 && firstLine <= lastLine && lastLine <= starts.length)) return null;
	const start = starts[firstLine - 1];
	const end = lastLine < starts.length ? starts[lastLine] - 1 : page.length;
	return (text.marks ?? []).every((m) => m.start >= start && m.end <= end) ? { start, end, lines: starts.length } : null;
}

/** A web page's (or a text file's) text view: its text as the quote checks
 *  read it, one block a line, every cited quote marked; for a page a model
 *  cropped, only its main content's lines, saying so (&full=1 for all). */
function webTextPage(hash, url, head, text, full, toggle) {
	const whole = text.pages[0] ?? '';
	const crop = full ? null : cropOf(text);
	const shown = crop ? whole.slice(crop.start, crop.end) : whole;
	const marks = (text.marks ?? []).map((m) => (crop ? { ...m, start: m.start - crop.start, end: m.end - crop.start } : m));
	const what = text.kind === 'html' ? 'The page' : 'The file';
	const note = `${what}'s text as the quote checks read it (${escape(text.extractedWith)}), one block a line; each quote the rules cite on it is highlighted. The archived bytes are the evidence: <a href="/sha256/${hash}/raw">raw bytes</a>.`;
	const cropNote = crop
		? `<p class="crop-note">Site navigation trimmed by ${escape((text.crop.answers ?? [{ model: text.crop.model }]).map((a) => modelName(a.model)).join(' and '))} (lines ${text.crop.firstLine}–${text.crop.lastLine} of the page's ${crop.lines}: from the earlier first line to the later last line they picked); nothing reworded — the full text: <a href="/sha256/${hash}?view=text&amp;full=1">?view=text&amp;full=1</a>.</p>`
		: full && cropOf(text)
			? `<p class="crop-note">The page's whole text, its site's navigation included; <a href="/sha256/${hash}?view=text">its main content only</a>.</p>`
			: '';
	return page(url, `<div class="capture"><article class="doc pdf-text">${toggle}<p class="pdf-note">${note}</p>${cropNote}${textHtml(shown, marks, 'lines')}</article>${head}</div>`);
}

/** A PDF as its text, page by page, so a link can open at a quoted
 *  sentence (browsers don't scroll a PDF to one); the PDF itself, the
 *  evidence, is a link away, at each page. The text is the PDF's own
 *  text layer, extracted by pdftotext (src/pdf-text.ts), in reading order:
 *  what quotes are checked against, and what citations link to. Two more
 *  views, asked for with ?view=: `layout`, the same text laid out as printed
 *  (pdftotext -layout), and `formatted`, table pages as Markdown by a model,
 *  only where one was made and kept. A scan, which has no text, shows its
 *  machine transcription, if made, labelled as unreviewed. */
async function pdfPage(env, hash, url, headOf, wanted) {
	const json = async (key) => {
		const object = await env.EVIDENCE.get(key);
		return object ? object.json() : null;
	};
	const [text, machine, formatted] = await Promise.all([json(`text/${hash}.json`), json(`text/${hash}.machine.json`), json(`text/${hash}.formatted.json`)]);
	const head = headOf(text?.marks ?? []);
	const pdf = `/sha256/${hash}/raw`;
	const pageLink = (i) => `<p class="page-no"><a href="${pdf}#page=${i + 1}">Page ${i + 1}</a></p>`;
	// A scan's machine transcription (src/pdf-machine.ts): every page of a
	// whole scan, or, in a PDF with text of its own, only its image-only
	// pages (null for a page with its own text layer).
	const [primary, ...rest] = (machine?.models ?? []).map(modelName);
	const other = rest[0] ?? 'the other model';
	const cutOffNote = (p) => (p.cutOff?.length ? `<p class="quiet">${escape(p.cutOff.map(modelName).join(' and '))} stopped at its length limit on this page: its reading may be incomplete.</p>` : '');
	const machinePage = (p) => `${cutOffNote(p)}<pre>${transcribed(p, other) || '<span class="quiet">(no text read on this page)</span>'}</pre>`;
	if (text?.scanned && machine?.pages?.some(Boolean)) {
		const count = machine.pages.reduce((n, p) => n + (p?.disagreements?.length ?? 0), 0);
		const pages = machine.pages
			.map((p, i) => `<section class="pdf-page" id="page-${i + 1}">${pageLink(i)}${p ? machinePage(p) : '<p class="quiet">(not transcribed)</p>'}</section>`)
			.join('');
		return page(
			url,
			`<div class="capture"><article class="doc pdf-text"><div class="machine-note"><p><strong>Machine transcription by ${escape([primary, ...rest].join(' and '))}, not reviewed — check against the PDF; quotes are never checked against it.</strong></p><p>This PDF is a scan, with no text of its own: ${escape(primary)} read each page and ${escape(other)} read it again. ${count ? `The ${count} place${count > 1 ? 's' : ''} where they read it differently ${count > 1 ? 'are' : 'is'} highlighted, with both readings.` : 'They read it the same.'} The PDF is the evidence: <a href="${pdf}">open the PDF</a>, or a page's number to open it there.</p></div>${pages}</article>${head}</div>`,
		);
	}
	if (text?.kind === 'word') {
		// A Word document: its text as the quote checks read it, one page.
		return page(
			url,
			`<div class="capture"><article class="doc pdf-text"><p class="pdf-note">The Word document's own text, as read by ${escape(text.extractedWith)}; each quote the rules cite on it is highlighted. The document is the evidence: <a href="${pdf}">download it</a>.</p>${textHtml(text.pages[0] ?? '', marksOnPage(text.marks, text.pages, 0), 'paras')}</article>${head}</div>`,
		);
	}
	if (!text || text.scanned) {
		const why = text?.scanned ? 'This PDF is a scan: it has no text layer to show.' : 'Its text hasn\'t been extracted yet.';
		return page(url, `<div class="capture"><div class="doc"><p class="pdf-note">${why} <a href="${pdf}">Open the PDF</a>.</p><object class="pdf" data="${pdf}" type="application/pdf"></object></div>${head}</div>`);
	}
	const hasLayout = Array.isArray(text.layout) && text.layout.length === text.pages.length;
	const formattedPages = formatted?.pages && Object.keys(formatted.pages).length ? formatted.pages : null;
	const offered = ['text', ...(hasLayout ? ['layout'] : []), ...(formattedPages ? ['formatted'] : [])];
	const view = offered.includes(wanted) ? wanted : 'text';
	const href = (v) => `/sha256/${hash}${v === 'text' ? '' : `?view=${v}`}`;
	const toggle = viewToggle(offered, view, href);
	// The text as paragraphs: a PDF's line breaks fall mid-sentence, so lines
	// are joined with spaces; blank lines stay breaks. Each cited quote is
	// marked where the upload found it (a mark that runs over a break keeps
	// it inside). The layout view keeps the lines as printed.
	const plain = (p, i) => textHtml(p, i === undefined ? [] : marksOnPage(text.marks, text.pages, i), 'paras');
	// An image-only page of a PDF with text of its own: its machine
	// transcription, labelled, where one was made.
	const scannedPage = (p, i) => {
		const m = !p.trim() && view !== 'formatted' ? machine?.pages?.[i] : null;
		return m
			? `<p class="machine-label">Scanned page: machine transcription by ${escape([primary, ...rest].join(' and '))}, not reviewed — check against the PDF; quotes are never checked against it.${m.disagreements?.length ? ' Where the two read it differently is highlighted, with both readings.' : ''}</p>${machinePage(m)}`
			: null;
	};
	const body = (p, i) => {
		const scanned = scannedPage(p, i);
		if (scanned) return scanned;
		if (view === 'layout') return `<pre class="layout">${escape(text.layout[i]) || '<span class="quiet">(no text on this page)</span>'}</pre>`;
		if (view === 'formatted') {
			const md = formattedPages[String(i + 1)];
			if (md === undefined) return `<p class="quiet">No formatted view of this page; its text:</p>${plain(p)}`;
			const recall = formatted.recall?.[String(i + 1)];
			return `<p class="machine-label">Formatted by ${escape(modelName(formatted.model))}, machine-made, not verified${typeof recall === 'number' ? `; it has ${(recall * 100).toFixed(1)}% of the page's words` : ''}. Check against the PDF.</p><div class="formatted">${markdown(md)}</div>`;
		}
		return plain(p, i);
	};
	const notes = {
		text: `The PDF's own text, page by page, as extracted by ${escape(text.extractedWith)}; each quote the rules cite on it is highlighted. The PDF is the evidence: <a href="${pdf}">open the PDF</a>, or a page's number to open it there.`,
		layout: `The PDF's own text laid out as printed (${escape(text.extractedWith)} -layout): columns side by side and tables in their columns. Quotes are checked against the text view; the PDF is the evidence: <a href="${pdf}">open the PDF</a>.`,
		formatted: `Table pages as Markdown, made by a model (${escape(modelName(formatted?.model ?? ''))}) from each page and kept only where it has the page's words; machine-made and not reviewed. Quotes are never checked against it, and citations never link to it; the PDF is the evidence: <a href="${pdf}">open the PDF</a>.`,
	};
	const pages = text.pages.map((p, i) => `<section class="pdf-page" id="page-${i + 1}">${pageLink(i)}${body(p, i)}</section>`).join('');
	return page(url, `<div class="capture"><article class="doc pdf-text${view === 'layout' ? ' wide' : ''}">${toggle}<p class="pdf-note">${notes[view]}</p>${pages}</article>${head}</div>`);
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
		// The newest capture that is the page, where one is.
		const last = r.captures.filter((c) => !c.bad).at(-1) ?? r.captures.at(-1);
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
			else response = m[2] ? await raw(env, m[1], found[0].capture) : await capturePage(env, m[1], found, asked, url.searchParams.get('view'), url.searchParams.get('full') === '1');
		} else if (url.pathname === '/url') {
			const target = url.searchParams.get('u') ?? '';
			const record = data.urls[target];
			response = record
				? page(target, `<div class="list url"><h1>${original(target)}</h1><p class="quiet">${record.captures.length} capture${record.captures.length > 1 ? 's' : ''}, oldest first${offline(target) ? `; the original is no longer online (checked ${escape(offlineList.checked)})` : ''}</p><ul>${record.captures
						.map((c) => `<li><a href="/sha256/${c.sha256}">${escape(c.at.replace('T', ' ').slice(0, 16))} UTC</a><span class="mono quiet">${c.sha256.slice(0, 12)}</span>${c.via ? ' <span class="quiet">· through the Internet Archive</span>' : ''}${c.bad ? ` <span class="bad-capture">· ${escape(badNote(c))}; see other captures</span>` : ''}</li>`)
						.join('')}</ul></div>`)
				: notArchived(data, target);
		} else if (/^\/\d{8}\//.test(url.pathname)) {
			const on = `${url.pathname.slice(1, 5)}-${url.pathname.slice(5, 7)}-${url.pathname.slice(7, 9)}T23:59:59Z`;
			const target = url.pathname.slice(10) + url.search;
			const record = data.urls[target];
			// A known-bad capture is never the page in force while a good one
			// is there; a day before the first good capture gets the earliest,
			// which says so, rather than passing it off as the page on that day.
			const chosen = record && captureOn(record.captures, on);
			const where = chosen && `/sha256/${chosen.capture.sha256}${chosen.early ? `?asked=${on.slice(0, 10)}` : ''}`;
			response = chosen ? Response.redirect(new URL(where, url).toString(), 302) : notArchived(data, target);
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
