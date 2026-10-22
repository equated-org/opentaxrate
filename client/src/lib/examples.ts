import type { Suggestion } from '$lib/search/types';

/** One address per engine, so a visitor can see a result without typing. */
export const EXAMPLES: Array<{ name: string; note: string; suggestion: Suggestion }> = [
	{
		name: 'Austin, TX',
		note: 'map lookup',
		suggestion: { label: '1100 Congress Ave, Austin, TX 78701', street: '1100 Congress Ave', city: 'Austin', state: 'TX', zip: '78701', lon: -97.74036, lat: 30.27471 }
	},
	{
		name: 'Columbus, OH',
		note: 'street range',
		suggestion: { label: '90 W Broad St, Columbus, OH 43215', street: '90 W Broad St', city: 'Columbus', state: 'OH', zip: '43215', lon: -83.0023, lat: 39.96172 }
	},
	{
		name: 'Portland, OR',
		note: 'no sales tax',
		suggestion: { label: '1221 SW 4th Ave, Portland, OR 97204', street: '1221 SW 4th Ave', city: 'Portland', state: 'OR', zip: '97204', lon: -122.67896, lat: 45.51499 }
	}
];

export const GITHUB = 'https://github.com/opentaxrate/opentaxrate';
