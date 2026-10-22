/**
 * The one call this page makes to OpenTaxRate: GET /v1/rate with
 * include=trace, read into one LookupResult whatever the status.
 */
import type { Geometry, MultiPolygon, Polygon } from 'geojson';

export type RateKind = 'state' | 'county' | 'city' | 'district';
export type Match = 'statewide' | 'street' | 'zip4' | 'zip5' | 'map' | 'zip_area' | 'authority';
export type Accuracy = 'rooftop' | 'parcel' | 'point' | 'interpolated';

export interface RatesByType {
	general: number;
	generalInterstate: number | null;
	foodDrug: number | null;
	foodDrugInterstate: number | null;
}

export interface RatePart {
	kind: RateKind;
	/** "Washington", "King County", "Seattle"; null where no source names it. */
	name?: string | null;
	/** The publisher's jurisdiction type and code, e.g. "00:061". */
	code: string;
	/** A decimal: 0.01 is 1%. */
	rate: number;
	byType?: RatesByType;
	/** The state's own ids for this jurisdiction, keyed by its data's column
	 *  names ({"Locality Code": "9454"}); {} where it publishes none. Absent
	 *  from an API older than ids. */
	ids?: Record<string, string>;
}

export interface AddressRate {
	state: string;
	rate: number;
	stateRate: number;
	localRate: number;
	/** Rates for other kinds of sale, where the state's files give them. */
	byType?: RatesByType;
	parts: RatePart[];
	match: Match;
	locationCode: string | null;
	/** The state's own ids for the whole location, e.g. Washington's
	 *  {"Composite SER Code": "01726"}; {} where it gives none. */
	locationIds?: Record<string, string>;
	source: string;
	/** Who the return goes to; absent from an API older than reporting. */
	reporting?: Reporting | null;
	/** Supplemental regional evidence, requested with include=regions. */
	regions?: Regions;
}

export interface RegionSource {
	id: string;
	url: string;
	snapshotId: string;
	edition: string | null;
	observedAt: string;
	startsOn: string | null;
	endsOn: string | null;
	dateBasis: 'published_edition' | 'latest_snapshot';
	note: string | null;
}

export interface Regions {
	matches: Array<{
		kind: 'transit' | 'tax_area' | 'special_district' | 'civil' | 'boundary_change' | 'police_jurisdiction';
		type: string;
		name: string | null;
		ids: Record<string, string>;
		featureId: string;
		attributes: Record<string, unknown>;
		source: RegionSource;
	}>;
	coverage: Array<{
		source: string;
		status: 'evaluated' | 'unavailable' | 'date_uncovered' | 'location_uncertain' | 'incomplete' | 'error';
		details?: RegionSource;
	}>;
}

export interface Reporting {
	agency: { name: string; url: string };
	form: string | null;
	notes: string[];
}

export interface LonLat {
	lon: number;
	lat: number;
}

/** What the engine used to decide, sent with include=trace. Optional
 *  throughout: an API from before the trace sends none. */
export interface Trace {
	geocoders: Array<LonLat & { source: 'census' | 'nominatim' | 'mapbox' | string; accuracy: Accuracy }>;
	point?: LonLat & { accuracy: Accuracy; source: string; marginMetres: number; spreadMetres: number };
	outlines: Array<{
		kind: 'county' | 'place' | 'cousub' | 'district' | string;
		fips: string;
		name: string;
		inside: boolean;
		edgeMetres: number;
		foot: LonLat;
		levies: boolean;
		geometry?: Polygon | MultiPolygon | Geometry;
	}>;
	range?: { street: string; low: number; high: number; side: 'odd' | 'even' | 'both'; zip: string | null; file: string };
}

export type Outline = Trace['outlines'][number];

export interface RateQuery {
	state: string;
	street: string;
	city: string;
	zip: string;
}

interface Common {
	query: RateQuery;
	/** The request as a person would repeat it (without include=trace). */
	url: string;
	/** The response body, for "Raw JSON". */
	raw: unknown;
}

export type LookupResult =
	| (Common & { kind: 'rate'; rate: AddressRate; trace: Trace | null })
	| (Common & { kind: 'refusal'; message: string; code: string; trace: Trace | null })
	| (Common & { kind: 'limited'; message: string; retryAfter: number | null })
	| (Common & { kind: 'failed'; message: string; status: number | null });

export const FIXTURES = ['austin', 'columbus', 'refusal', 'limited'] as const;
export type FixtureName = (typeof FIXTURES)[number];

/** PUBLIC_API_URL; empty means this page's own origin (the dev proxy). */
export function apiBase(): string {
	const configured = import.meta.env.PUBLIC_API_URL;
	return (configured === undefined ? 'http://localhost:8080' : configured).replace(/\/+$/, '');
}

export function rateUrl(q: RateQuery, trace: boolean): string {
	const params = new URLSearchParams({ state: q.state, street: q.street, city: q.city });
	if (q.zip) params.set('zip', q.zip);
	if (trace) params.set('include', 'trace');
	const path = `${apiBase()}/v1/rate?${params}`;
	return path.startsWith('/') && typeof location !== 'undefined' ? location.origin + path : path;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

function traceOf(body: unknown): Trace | null {
	if (!isObject(body) || !isObject(body.trace)) return null;
	const t = body.trace as Partial<Trace>;
	return { geocoders: t.geocoders ?? [], outlines: t.outlines ?? [], point: t.point, range: t.range };
}

/** Seconds to wait, from Retry-After (seconds or an HTTP date). */
function retryAfter(header: string | null): number | null {
	if (!header) return null;
	const seconds = Number(header);
	if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
	const at = Date.parse(header);
	return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** One response, whatever its status, as a LookupResult. */
export function read(query: RateQuery, status: number, headers: Headers, body: unknown): LookupResult {
	const url = rateUrl(query, false);
	const common = { query, url, raw: body };
	const message = isObject(body) && typeof body.error === 'string' ? body.error : null;
	const code = isObject(body) && typeof body.code === 'string' ? body.code : '';

	if (status === 200 && isObject(body) && typeof body.rate === 'number' && Array.isArray(body.parts)) {
		const { trace: _trace, ...rate } = body;
		return { ...common, kind: 'rate', rate: rate as unknown as AddressRate, trace: traceOf(body) };
	}
	if (status === 429 || code === 'RATE_LIMITED')
		return {
			...common,
			kind: 'limited',
			message: message ?? 'Too many lookups from this address.',
			retryAfter: retryAfter(headers.get('retry-after'))
		};
	if (status === 422)
		return {
			...common,
			kind: 'refusal',
			message: message ?? "This address couldn't be given one rate.",
			code: code || 'ADDRESS_NEEDS_CONFIRMATION',
			trace: traceOf(body)
		};
	if (status === 400)
		return { ...common, kind: 'failed', status, message: message ?? 'The API rejected the address fields.' };
	if (status === 502 || status === 504)
		return {
			...common,
			kind: 'failed',
			status,
			message: message ?? 'A data source the API depends on is down. Try again in a minute.'
		};
	return {
		...common,
		kind: 'failed',
		status,
		message: message ? `${message} (HTTP ${status})` : `The API answered HTTP ${status}.`
	};
}

/** Look the address up. Never throws except an AbortError when `signal`
 *  aborts; every other failure is a `failed` result. */
export async function lookUp(query: RateQuery, signal: AbortSignal, fixture?: string | null): Promise<LookupResult> {
	if (import.meta.env.DEV && fixture) {
		// Dev only: canned responses for screenshots and work without an API
		// that sends trace. The branch and the JSON drop out of the build.
		const files = import.meta.glob('./fixtures/*.json', { import: 'default' });
		const load = files[`./fixtures/${fixture}.json`];
		if (load) {
			await new Promise((r) => setTimeout(r, 900));
			signal.throwIfAborted();
			const body = (await load()) as Record<string, unknown>;
			const status = body.code === 'RATE_LIMITED' ? 429 : 'error' in body ? 422 : 200;
			const headers = new Headers(status === 429 ? { 'retry-after': String(body.retryAfter ?? 42) } : {});
			const { retryAfter: _r, ...rest } = body;
			return read(query, status, headers, rest);
		}
	}

	const url = rateUrl(query, true);
	let response: Response;
	try {
		response = await fetch(url, { signal, headers: { accept: 'application/json' } });
	} catch (error) {
		if (signal.aborted) throw error;
		return {
			query,
			url: rateUrl(query, false),
			raw: null,
			kind: 'failed',
			status: null,
			message: `Couldn't reach the API at ${apiBase() || location.origin}. It may be down, or not allow this page's origin (CORS).`
		};
	}
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
	}
	return read(query, response.status, response.headers, body);
}
