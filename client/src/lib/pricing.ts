/** The pricing table's data (pricing.json), typed. Published prices and our
 *  estimates are separate fields so the page can never blend them. */
import raw from './pricing.json';

export type Source = { label: string; url: string; checked: string };
export type PriceRow = {
	id: string;
	name: string;
	ours?: boolean;
	/** The vendor's own figure, in its own units. */
	published: string;
	/** Our arithmetic per 1,000 lookups; never a vendor price. */
	estimate: string;
	/** A plain-words reading of the estimate, under the figure. */
	estimateNote?: string;
	/** Ids of the caveats that change how to read this row's estimate. */
	notes: string[];
	/** How the estimate was worked out; shown in a drawer. */
	method: string;
	/** Line-by-line working, listed under the method. */
	breakdown?: string[];
	sources: Source[];
};
export type Pricing = {
	asOf: string;
	rows: PriceRow[];
	notes: { id: string; text: string }[];
	quoteOnly: { name: string; url: string }[];
};

export const pricing = raw as Pricing;

/** Caveat id → its number, by order in the notes list. */
export function noteNumbers(p: Pricing): Record<string, number> {
	return Object.fromEntries(p.notes.map((n, i) => [n.id, i + 1]));
}
