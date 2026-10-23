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
 * Montana has no state sales tax, but its resort areas levy their own; they
 * are read from the map (ingest/states/montana.ts, rates/index.ts). Alaska
 * has no state tax and many local ones, so it is not statewide.
 */

interface DatedRate {
  rate: number;
  /** First day the rate applies. */
  from: string;
  /** Last day the state's own notice settles the rate, where a change after
   *  it is announced but not certain; a later sale is refused with `after`. */
  until?: string;
  after?: string;
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
  // DC Office of Tax and Revenue, notice of Oct 1 2025 tax changes and its
  // site-wide notice (seen 2026-10-23): the rise to 7% has been postponed,
  // and the general rate "remains 6% through September 30, 2027". What
  // applies after isn't settled by OTR (the rise has moved before), so a
  // later sale is refused.
  DC: [{
    rate: 0.06, from: "2013-10-01", until: "2027-09-30",
    after: "DC's general rate is 6% through September 30, 2027; a rise to 7% has been postponed, and the Office of Tax and Revenue hasn't settled the rate after that. Confirm it with OTR.",
  }],
};

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
  const found = history.find((r) => r.from <= date);
  if (!found)
    return {
      refused: `This service has ${state}'s rate only from ${history.at(-1)!.from}.`,
    };
  if (found.until && date > found.until)
    return { refused: found.after ?? `This service has ${state}'s rate only through ${found.until}.` };
  return { rate: found.rate, from: found.from };
}
