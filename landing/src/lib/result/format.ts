/** Turning an AddressRate and its trace into the words and colours the
 *  list and the map show. No markup here. */
import type { AddressRate, Outline, RatePart, Trace } from '$lib/api';
import { stateName } from '$lib/states';

/** 0.0825 → "8.25%", 0.01875 → "1.875%", 0 → "0%"... with at least two
 *  decimals unless `short`. */
export function pct(rate: number, short = false): string {
	const value = Math.round(rate * 100 * 1e4) / 1e4;
	if (short && Number.isInteger(value)) return `${value}%`;
	const [int, frac = ''] = String(value).split('.');
	return `${int}.${frac.padEnd(2, '0')}%`;
}

export function distance(metres: number): string {
	if (metres < 1000) return `${Math.round(metres)} m`;
	return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

export const PART_COLOR: Record<string, string> = {
	state: 'var(--part-state)',
	county: 'var(--part-county)',
	city: 'var(--part-city)',
	district: 'var(--part-district)'
};

const KIND_LABEL: Record<string, string> = {
	state: 'State',
	county: 'County',
	city: 'City',
	district: 'District',
	place: 'City',
	cousub: 'Township'
};

export const GEOCODER_NAME: Record<string, string> = {
	census: 'Census',
	nominatim: 'OpenStreetMap',
	mapbox: 'Mapbox'
};

/** Which outline kinds can stand for which part kind. */
const OUTLINE_KINDS: Record<string, string[]> = {
	county: ['county'],
	city: ['place', 'cousub'],
	district: ['district', 'place', 'cousub']
};

/** The last code in a part's code: "kx:2227016>3227999" → "3227999". */
const lastCode = (code: string) => code.split(/[:>]/).pop() ?? code;

export function outlineFor(part: RatePart, outlines: Outline[]): Outline | undefined {
	const kinds = OUTLINE_KINDS[part.kind];
	if (!kinds) return undefined;
	const code = lastCode(part.code);
	const candidates = outlines.filter((o) => o.inside && kinds.includes(o.kind));
	return (
		candidates.find((o) => o.fips === code) ??
		(code.length >= 3 ? candidates.find((o) => o.fips.endsWith(code) || code.endsWith(o.fips)) : undefined)
	);
}

export function outlineName(o: Pick<Outline, 'kind' | 'name'>): string {
	if (o.kind === 'county') return /\b(county|parish|borough)\b/i.test(o.name) ? o.name : `${o.name} County`;
	if (o.kind === 'place') return `City of ${o.name}`;
	if (o.kind === 'cousub') return `${o.name} Township`;
	return o.name;
}

export interface PartRow {
	name: string;
	/** The publisher's code, shown small when a name was found. */
	code: string | null;
	rate: number;
	color: string;
	/** An outline the address is inside that levies nothing. */
	dim: boolean;
}

export function partRows(rate: AddressRate, trace: Trace | null): PartRow[] {
	const outlines = trace?.outlines ?? [];
	const used = new Set<Outline>();
	const rows: PartRow[] = rate.parts.map((part) => {
		if (part.kind === 'state')
			return { name: `State of ${stateName(rate.state)}`, code: null, rate: part.rate, color: PART_COLOR.state, dim: false };
		const o = outlineFor(part, outlines);
		if (o) used.add(o);
		return {
			name: o ? outlineName(o) : `${KIND_LABEL[part.kind] ?? part.kind} ${part.code}`,
			code: o ? part.code : null,
			rate: part.rate,
			color: PART_COLOR[part.kind] ?? 'var(--text-muted)',
			dim: false
		};
	});
	for (const o of outlines)
		if (o.inside && !o.levies && !used.has(o))
			rows.push({ name: `${outlineName(o)} levies none`, code: null, rate: 0, color: 'var(--border)', dim: true });
	return rows;
}

/** The few words after the date under the big rate. */
export const MATCH_SHORT: Record<string, string> = {
	statewide: 'one rate statewide',
	street: 'matched by street range',
	zip4: 'matched by ZIP+4',
	zip5: 'one rate across the ZIP',
	map: 'placed on the map',
	authority: "from the state's own lookup"
};

const SIDE: Record<string, string> = { odd: 'odd side', even: 'even side', both: 'both sides' };

/** The point's nearest outline edge, when the trace has one. */
export function nearestEdge(trace: Trace | null): Outline | undefined {
	if (!trace?.point) return undefined;
	return [...trace.outlines].sort((a, b) => a.edgeMetres - b.edgeMetres)[0];
}

const titleCase = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** "How it was placed": one or two sentences per match type. */
export function howPlaced(rate: AddressRate, trace: Trace | null): string[] {
	const state = stateName(rate.state);
	const range = trace?.range;
	switch (rate.match) {
		case 'statewide':
			return rate.rate === 0
				? [`${state} has no general sales tax, so every address there is 0%.`]
				: [`One rate across ${state}; no local part to place.`];
		case 'authority':
			return [
				`Asked ${state}'s tax office's live address lookup${rate.locationCode ? `, which returned tax area ${rate.locationCode}` : ''}.`
			];
		case 'street':
			return range
				? [
						range.low === range.high
							? `Matched ${range.low} ${titleCase(range.street)} exactly in ${state}'s address file (${range.file}).`
							: `Matched ${range.low}–${range.high} ${titleCase(range.street)}, ${SIDE[range.side] ?? range.side}, in ${state}'s address file (${range.file}).`
					]
				: [`Matched a street range in ${state}'s address file.`];
		case 'zip4':
			return [range?.zip ? `Matched ZIP+4 ${range.zip}'s range in ${state}'s address file.` : `Matched a ZIP+4 range in ${state}'s address file.`];
		case 'zip5':
			return [`Every range in ${range?.zip ? `ZIP ${range.zip}` : 'the ZIP'} has this rate, so the street didn't need to match.`];
		case 'map':
			return mapLines(trace);
	}
	return [];
}

function mapLines(trace: Trace | null): string[] {
	if (!trace?.point)
		return ['Placed by its point on the map, inside the county, city and district outlines that set the rate.'];
	const p = trace.point;
	const drawn = trace.geocoders.filter((g) => g.source !== 'mapbox');
	const names = drawn.map((g) => GEOCODER_NAME[g.source] ?? g.source);
	const lines: string[] = [];
	if (names.length >= 2)
		lines.push(`${names.slice(0, -1).join(', ')} and ${names.at(-1)} agree within ${distance(p.spreadMetres)}.`);
	else if (names.length === 1) lines.push(`Placed by ${names[0]} (${drawn[0].accuracy}).`);
	if (trace.geocoders.some((g) => g.source === 'mapbox'))
		lines.push("Mapbox placed it too; its point isn't drawn, since its terms keep it to Mapbox maps.");
	const near = nearestEdge(trace);
	lines.push(
		near && near.edgeMetres > p.marginMetres
			? `No line within the ${distance(p.marginMetres)} margin; the nearest, ${near.name}'s, is ${distance(near.edgeMetres)} away.`
			: `No line within the ${distance(p.marginMetres)} margin.`
	);
	return lines;
}
