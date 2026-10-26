import { stateCode } from '$lib/states';
import { labelOf, type Suggestion } from './types';

interface GeoapifyResult {
	country_code?: string;
	housenumber?: string;
	street?: string;
	city?: string;
	town?: string;
	village?: string;
	county?: string;
	state?: string;
	state_code?: string;
	postcode?: string;
	lon: number;
	lat: number;
}

/** Geoapify's autocomplete. The key ships in the bundle, so restrict it to
 *  the site's origins in Geoapify's console; the free plan hard-stops at its
 *  daily cap. */
export function geoapify(apiKey: string) {
	return async (text: string, signal: AbortSignal): Promise<Suggestion[]> => {
		if (!apiKey) throw new Error('PUBLIC_GEOAPIFY_KEY is not set');
		const params = new URLSearchParams({
			text,
			filter: 'countrycode:us,ca',
			format: 'json',
			lang: 'en',
			limit: '8',
			apiKey
		});
		const response = await fetch(`https://api.geoapify.com/v1/geocode/autocomplete?${params}`, { signal });
		if (!response.ok) throw new Error(`Geoapify answered ${response.status}`);
		const body = (await response.json()) as { results?: GeoapifyResult[] };
		const out: Suggestion[] = [];
		for (const r of body.results ?? []) {
			const state = stateCode(r.state_code) ?? stateCode(r.state);
			if (!state || !r.street) continue;
			const fields = {
				street: [r.housenumber, r.street].filter(Boolean).join(' '),
				city: r.city ?? r.town ?? r.village ?? '',
				state,
				zip: r.postcode ?? ''
			};
			out.push({ ...fields, label: labelOf(fields), lon: r.lon, lat: r.lat });
		}
		return out;
	};
}
