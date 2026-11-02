/**
 * Links into OpenTaxRate's evidence archive (evidence.opentaxrate.com,
 * evidence/worker.js): every page a rule or rate was read from, kept by its
 * SHA-256 as fetched.
 */
import offlineList from './offline-originals.json';

export const EVIDENCE = 'https://evidence.opentaxrate.com';

/** Cited pages that were gone when last checked (404/410, no DNS, or a
 *  certificate no browser accepts), written by `scripts/check-links.mts
 *  --write-offline`. Their archived copy is the evidence; the original is
 *  named but not linked. */
export const offlineChecked: string = offlineList.checked;
const offlineUrls = new Set(Object.keys(offlineList.urls));
export const offline = (url: string) => offlineUrls.has(url);

/** Every archived capture of one URL. */
export const captures = (url: string) => `${EVIDENCE}/url?u=${encodeURIComponent(url)}`;

/** The archived copy of `url` in force on `date` (YYYY-MM-DD), scrolled to
 *  `quote` when given: its words, or a long one's first and last four.
 *  Only a fallback: a citation the API pinned to a copy comes with
 *  `archived`, which opens that copy's text view at the quote's mark
 *  (?view=text#q-…). One without it has no copy whose text has the quote,
 *  so no mark exists to link to, and a text fragment is all there is. */
export function archivedOn(url: string, date: string, quote?: string): string {
	const day = date.replaceAll('-', '');
	const words = (quote ?? '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
	const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D');
	const fragment = !words.length
		? ''
		: words.length <= 8
			? `#:~:text=${enc(words.join(' '))}`
			: `#:~:text=${enc(words.slice(0, 4).join(' '))},${enc(words.slice(-4).join(' '))}`;
	return `${EVIDENCE}/${day}/${url}${fragment}`;
}

/** A page the taxability rules cite, and how many of a place's rules cite it
 *  (built from the rule files by routes/sources/+page.server.ts). */
export interface CitedPage {
	url: string;
	title: string;
	/** Rules citing this page. */
	rules: number;
}
export interface PlaceSources {
	place: string;
	country: 'US' | 'CA';
	name: string;
	rules: number;
	pages: CitedPage[];
}
