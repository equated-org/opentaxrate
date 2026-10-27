import type { Suggestion } from '$lib/search/types';

/**
 * Three addresses in one ZIP, each mailed to "Aurora, CO 80015", in three
 * tax areas: unincorporated Arapahoe County (4.25%), Centennial (6.75%) and
 * Aurora (8%). Each rate matched Colorado DOR's own lookup on 2026-10-27,
 * and the public tier places each on the map with no key. The landing's
 * showcase draws them from showcase-aurora.json; `pnpm --dir client
 * showcase` rebuilds it and checks the rates.
 */
export const SAME_ZIP: Suggestion[] = [
	{ label: '5250 S Picadilly St, Aurora, CO 80015', street: '5250 S Picadilly St', city: 'Aurora', state: 'CO', zip: '80015', lon: -104.73695, lat: 39.62136 },
	{ label: '21392 E Williamette Pl, Aurora, CO 80015', street: '21392 E Williamette Pl', city: 'Aurora', state: 'CO', zip: '80015', lon: -104.73916, lat: 39.6211 },
	{ label: '19062 E Bellewood Dr, Aurora, CO 80015', street: '19062 E Bellewood Dr', city: 'Aurora', state: 'CO', zip: '80015', lon: -104.76693, lat: 39.62438 }
];

/** Something to click without typing: one per kind of answer. `compare`
 *  opens the addresses side by side instead of one result. */
export const EXAMPLES: Array<{ name: string; note: string; suggestion: Suggestion; compare?: Suggestion[] }> = [
	{
		name: 'Columbus, OH',
		note: 'street range',
		suggestion: { label: '90 W Broad St, Columbus, OH 43215', street: '90 W Broad St', city: 'Columbus', state: 'OH', zip: '43215', lon: -83.0023, lat: 39.96172 }
	},
	{ name: 'Aurora, CO', note: 'one ZIP, three rates', suggestion: SAME_ZIP[0], compare: SAME_ZIP },
	{
		name: 'Murphy, TX',
		note: 'declined: on a city line',
		suggestion: { label: '621 Seminole Trl, Murphy, TX 75094', street: '621 Seminole Trl', city: 'Murphy', state: 'TX', zip: '75094', lon: -96.59754, lat: 33.04044 }
	},
	{
		name: 'Portland, OR',
		note: 'no sales tax',
		suggestion: { label: '1221 SW 4th Ave, Portland, OR 97204', street: '1221 SW 4th Ave', city: 'Portland', state: 'OR', zip: '97204', lon: -122.67896, lat: 45.51499 }
	}
];

export const GITHUB = 'https://github.com/equated-org/opentaxrate';
