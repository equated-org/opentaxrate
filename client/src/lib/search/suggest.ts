import { stateName } from '$lib/states';
import { geoapify } from './geoapify';
import { parseAddress } from './parse';
import { photon } from './photon';
import { hasHouseNumber, labelOf, type Suggest, type Suggestion } from './types';

export type { Suggestion };
export { hasHouseNumber };

const MAX = 5;

function provider(): Suggest {
	const which = (import.meta.env.PUBLIC_SUGGEST || 'photon').toLowerCase();
	if (which === 'geoapify') return geoapify(import.meta.env.PUBLIC_GEOAPIFY_KEY ?? '');
	return photon(import.meta.env.PUBLIC_PHOTON_URL || 'https://photon.komoot.io');
}

let chosen: Suggest | null = null;

/** A street-level result with the typed house number put in front. OSM
 *  often has the street but not the house; the API only needs the fields. */
function withNumber(s: Suggestion, number: string): Suggestion {
	const fields = { street: `${number} ${s.street}`, city: s.city, state: s.state, zip: s.zip };
	return { ...fields, label: labelOf(fields), lon: s.lon, lat: s.lat, from: 'street' };
}

/** Up to five US addresses for what's been typed, one per label: in the
 *  typed city or state first, then exact houses before streets given the
 *  typed number. A street with nothing typed to number it stays, and the
 *  box shows it disabled. Rejects with an AbortError on abort. */
export async function suggest(text: string, signal: AbortSignal): Promise<Suggestion[]> {
	chosen ??= provider();
	const typedNumber = text.trim().match(/^\d+[A-Za-z]?(?=\s)/)?.[0];
	const typedZip = text.match(/\b\d{5}(?:-\d{4})?\s*$/)?.[0].trim() ?? '';
	// A street, or a house on the typed street with another number, becomes
	// the typed number on that street. Its ZIP may not be the house's, so
	// only a typed ZIP goes with it.
	const typedWords = new Set(text.toLowerCase().split(/[^a-z0-9]+/));
	const all = (await chosen(text, signal)).flatMap((s) => {
		if (!typedNumber) return [s];
		const number = s.street.match(/^\d+[A-Za-z]?(?=\s)/)?.[0];
		if (number?.toLowerCase() === typedNumber.toLowerCase()) return [s];
		const street = number ? s.street.slice(number.length).trim() : s.street;
		// A neighbour on some other street isn't a guess at this address.
		if (number && !street.toLowerCase().split(/[^a-z0-9]+/).some((w) => w.length >= 3 && typedWords.has(w))) return [s];
		return [withNumber({ ...s, street, zip: typedZip }, typedNumber)];
	});
	const seen = new Set<string>();
	const unique = all.filter((s) => {
		const key = s.label.toLowerCase();
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const typed = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
	const named = (part: string) => !!part && typed.includes(` ${part.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `);
	const rank = (s: Suggestion) => {
		// A typed city or state counts for more than an exact number elsewhere.
		const place = named(s.city) || named(s.state) || named(stateName(s.state)) ? 0 : 3;
		if (!hasHouseNumber(s)) return 3 + place;
		if (!typedNumber) return place;
		if (s.from === 'street') return 1 + place;
		return (s.street.startsWith(typedNumber + ' ') ? 0 : 2) + place;
	};
	return unique
		.map((s, i) => [s, i] as const)
		.sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
		.map(([s]) => s)
		.slice(0, MAX);
}

/** Whether Enter may take `s` for the typed text without the visitor
 *  choosing it: the same house number on a known house, in the city the
 *  text names. Otherwise Enter looks up the text as typed. */
export function matchesTyped(text: string, s: Suggestion): boolean {
	const typedNumber = text.trim().match(/^\d+[A-Za-z]?(?=\s)/)?.[0];
	if (!typedNumber || s.from === 'street' || !s.street.startsWith(typedNumber + ' ')) return false;
	const typed = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
	const named = (part: string) => !!part && typed.includes(` ${part.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `);
	return named(s.city);
}

/** Text from a shared ?q= link or typed and entered → the address to look
 *  up. The fields come from the text itself when it parses; the point (to
 *  center the map) from the autocomplete's best match, if any. Null with a
 *  reason when the text can't be read as an address. */
export async function resolve(
	text: string,
	signal: AbortSignal
): Promise<{ ok: true; suggestion: Suggestion } | { ok: false; reason: 'number' | 'state' | 'city' }> {
	const parsed = parseAddress(text);
	let found: Suggestion[] = [];
	try {
		found = (await suggest(text, signal)).filter(hasHouseNumber);
	} catch (error) {
		if (signal.aborted) throw error;
		// The autocomplete being down shouldn't stop a lookup we can parse.
	}
	if (!parsed.ok) return parsed;
	const a = parsed.address;
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	const number = a.street.split(' ')[0];
	// Only a match in the same city and state may lend its point.
	const near = found.filter((s) => s.state === a.state && norm(s.city) === norm(a.city));
	const best = near.find((s) => s.street.startsWith(number + ' ') && s.from !== 'street') ?? near[0];
	return {
		ok: true,
		suggestion: { ...a, label: text.trim(), lon: best?.lon ?? NaN, lat: best?.lat ?? NaN, from: best?.from }
	};
}
