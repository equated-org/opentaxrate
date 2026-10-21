/**
 * States whose general sales tax is the same at every address, so no
 * boundary data is needed: those with no sales tax, and those with one
 * statewide rate and no local add-ons. Streamlined members with one rate
 * (Indiana, Kentucky, Michigan, New Jersey, Rhode Island) come from their own
 * files instead.
 *
 * Each rate is dated; a sale before a state's first listed date is refused
 * rather than given today's rate. Rates on particular goods (Connecticut's
 * meals, Massachusetts's local meals tax, Maryland's IT services) are not the
 * general rate and are not here.
 *
 * Montana has no state sales tax, but ten resort areas levy their own, so an
 * address in one is refused for the owner to confirm. Alaska has no state
 * tax and many local ones, so it is not statewide.
 */

interface DatedRate {
  rate: number;
  /** First day the rate applies. */
  from: string;
}

/** Newest first. */
const RATES: Record<string, DatedRate[]> = {
  DE: [{ rate: 0, from: "2000-01-01" }],
  NH: [{ rate: 0, from: "2000-01-01" }],
  OR: [{ rate: 0, from: "2000-01-01" }],
  MT: [{ rate: 0, from: "2000-01-01" }],
  CT: [{ rate: 0.0635, from: "2011-07-01" }],
  ME: [{ rate: 0.055, from: "2013-10-01" }],
  MD: [{ rate: 0.06, from: "2008-01-03" }],
  MA: [{ rate: 0.0625, from: "2009-08-01" }],
  // DC Office of Tax and Revenue, notice of Oct 1 2025 tax changes: the
  // general rate stays 6%; the rise to 7% once set for Oct 1 2026 has been
  // postponed, and OTR now says 6% applies through Sept 30 2027.
  DC: [{ rate: 0.06, from: "2013-10-01" }],
};

/** Montana Department of Revenue's resort areas, by the city an address in
 *  each carries. */
const MONTANA_RESORT_AREAS = new Set([
  "RED LODGE",
  "VIRGINIA CITY",
  "WEST YELLOWSTONE",
  "WHITEFISH",
  "BIG SKY",
  "COOKE CITY",
  "CRAIG",
  "GARDINER",
  "ST REGIS",
  "SAINT REGIS",
  "WOLF CREEK",
  // Cooke City's resort area takes in Silver Gate, which has its own ZIP.
  "SILVER GATE",
]);

export const STATEWIDE_STATES = Object.keys(RATES);

export type StatewideRate =
  | { rate: number; from: string }
  | { refused: string };

/** The state's one rate on `date`, a reason it can't be given, or null for a
 *  state that isn't statewide. */
export function statewideRate(
  state: string,
  date: string,
  city?: string | null,
): StatewideRate | null {
  const history = RATES[state];
  if (!history) return null;
  const normalizedCity = (city ?? "").toUpperCase().replace(/\./g, "").trim();
  if (state === "MT" && MONTANA_RESORT_AREAS.has(normalizedCity))
    return {
      refused: `${city} is a Montana resort area with its own local resort tax. Confirm its rate with the town.`,
    };
  const found = history.find((r) => r.from <= date);
  if (!found)
    return {
      refused: `This service has ${state}'s rate only from ${history.at(-1)!.from}.`,
    };
  return found;
}
