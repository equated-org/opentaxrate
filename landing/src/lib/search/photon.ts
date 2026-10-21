import { stateCode } from '$lib/states';
import { labelOf, type Suggestion } from './types';

/** The lower 48 plus a margin; Photon only ranks inside it. */
const US_BBOX = '-125,24,-66,50';

interface PhotonFeature {
	geometry: { coordinates: [number, number] };
	properties: {
		countrycode?: string;
		type?: string;
		housenumber?: string;
		street?: string;
		name?: string;
		city?: string;
		town?: string;
		village?: string;
		locality?: string;
		district?: string;
		state?: string;
		postcode?: string;
	};
}

/** Photon (komoot's public instance, or a self-hosted one): one GET per
 *  keystroke burst, no key. */
export function photon(baseUrl: string) {
	const base = baseUrl.replace(/\/+$/, '');
	return async (text: string, signal: AbortSignal): Promise<Suggestion[]> => {
		const params = new URLSearchParams({ q: text, bbox: US_BBOX, layer: 'house', limit: '8', lang: 'en' });
		// Streets too: OSM lacks many houses, and a street can take the typed number.
		params.append('layer', 'street');
		const response = await fetch(`${base}/api?${params}`, { signal });
		if (!response.ok) throw new Error(`Photon answered ${response.status}`);
		const body = (await response.json()) as { features?: PhotonFeature[] };
		const out: Suggestion[] = [];
		for (const f of body.features ?? []) {
			const p = f.properties;
			if (p.countrycode && p.countrycode.toUpperCase() !== 'US') continue;
			const state = stateCode(p.state);
			if (!state) continue;
			// A house needs its number; a street result names the street.
			if (!p.housenumber && p.type !== 'street') continue;
			const streetName = p.housenumber ? p.street : p.name;
			if (!streetName) continue;
			const fields = {
				street: [p.housenumber, streetName].filter(Boolean).join(' '),
				city: p.city ?? p.town ?? p.village ?? p.locality ?? p.district ?? '',
				state,
				zip: (p.postcode ?? '').split(/[;,]/)[0].trim()
			};
			const [lon, lat] = f.geometry.coordinates;
			out.push({ ...fields, label: labelOf(fields), lon, lat });
		}
		return out;
	};
}
