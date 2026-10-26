/** US states and territories, and Canada's provinces and territories:
 *  two-letter code ↔ name. No code is both. */
export const STATE_NAMES: Record<string, string> = {
	AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
	CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
	HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
	KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts',
	MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
	NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
	NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
	OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
	TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
	WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico'
};

export const PROVINCE_NAMES: Record<string, string> = {
	AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
	NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories', NU: 'Nunavut',
	ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec', SK: 'Saskatchewan', YT: 'Yukon'
};

/** Every state and province, by code. */
export const PLACE_NAMES: Record<string, string> = { ...STATE_NAMES, ...PROVINCE_NAMES };

export const isProvince = (code: string) => code.toUpperCase() in PROVINCE_NAMES;

const BY_NAME = new Map([...Object.entries(PLACE_NAMES), ['QC', 'Québec']].map(([code, name]) => [name.toLowerCase(), code]));

/** "Texas" or "TX" → "TX", "Ontario" → "ON"; anything else → null. */
export function stateCode(value: string | undefined | null): string | null {
	if (!value) return null;
	const v = value.trim();
	if (v.length === 2 && PLACE_NAMES[v.toUpperCase()]) return v.toUpperCase();
	return BY_NAME.get(v.toLowerCase()) ?? null;
}

export const stateName = (code: string) => PLACE_NAMES[code.toUpperCase()] ?? code;
