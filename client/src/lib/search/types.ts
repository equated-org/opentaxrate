/** One address the autocomplete offers, already split into the fields
 *  /v1/rate asks for. `lon`/`lat` only center the map when the API's trace
 *  has no point of its own. */
export interface Suggestion {
	label: string;
	/** House number and street, e.g. "1100 Congress Ave". */
	street: string;
	city: string;
	/** Two-letter code. */
	state: string;
	zip: string;
	lon: number;
	lat: number;
	/** "street": the autocomplete knew the street but not the house, and the
	 *  typed number was put in front; lon/lat are the street's. */
	from?: 'street';
}

export type Suggest = (text: string, signal: AbortSignal) => Promise<Suggestion[]>;

/** The range engine needs a house number; a street or a city alone can't be
 *  looked up. */
export const hasHouseNumber = (s: Pick<Suggestion, 'street'>) => /^\d/.test(s.street.trim());

export function labelOf(s: Omit<Suggestion, 'label' | 'lon' | 'lat'>): string {
	const tail = [s.state, s.zip].filter(Boolean).join(' ');
	return [s.street, s.city, tail].filter(Boolean).join(', ');
}
