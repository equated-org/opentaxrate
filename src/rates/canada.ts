/**
 * Canada's provinces and territories, answered like a statewide state: no
 * province has local sales taxes, so the rate follows the province alone and
 * the address is never placed. The parts are the federal GST, or the HST in
 * its place, and the province's own PST, QST or RST where it levies one; a
 * province's code never collides with a state's.
 *
 * Each rate is dated from April 1, 2013; an earlier sale is refused, as is
 * a postal code from another province.
 *
 * Sources, seen 2026-10-26:
 *   - GST/HST and its history since April 1, 2013, and Québec's QST: CRA,
 *     https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html
 *   - BC PST 7%: https://www2.gov.bc.ca/gov/content/taxes/sales-taxes/pst
 *   - Manitoba RST 7%, 8% from July 1, 2013 to June 30, 2019:
 *     https://www.gov.mb.ca/finance/taxation/taxes/retail.html and Bulletin
 *     119, https://www.gov.mb.ca/finance/taxation/pubs/bulletins/2019budget.pdf
 *   - Saskatchewan PST 6%, 5% before March 23, 2017:
 *     https://www.saskatchewan.ca/business/taxes-licensing-and-reporting/provincial-taxes-policies-and-bulletins/provincial-sales-tax
 *     (the date from firms' summaries of the 2017-18 budget, not the
 *     ministry's own notice).
 */
import { RateError } from "../errors.js";
import type { RatePart } from "./types.js";

interface Province {
  name: string;
  /** The federal tax, and the province's own where it has one. */
  federal: "GST" | "HST";
  own?: "PST" | "QST" | "RST";
  /** The first letters of its postal codes. */
  postal: string;
  /** Newest first: the federal rate, and the province's own. */
  rates: Array<{ from: string; federal: number; own?: number }>;
}

const FROM = "2013-04-01";
const gst = (own?: number) => [{ from: FROM, federal: 0.05, own }];

export const PROVINCES: Record<string, Province> = {
  AB: { name: "Alberta", federal: "GST", postal: "T", rates: gst() },
  BC: { name: "British Columbia", federal: "GST", own: "PST", postal: "V", rates: gst(0.07) },
  MB: {
    name: "Manitoba", federal: "GST", own: "RST", postal: "R",
    rates: [{ from: "2019-07-01", federal: 0.05, own: 0.07 }, { from: "2013-07-01", federal: 0.05, own: 0.08 }, ...gst(0.07)],
  },
  NB: { name: "New Brunswick", federal: "HST", postal: "E", rates: [{ from: "2016-07-01", federal: 0.15 }, { from: FROM, federal: 0.13 }] },
  NL: { name: "Newfoundland and Labrador", federal: "HST", postal: "A", rates: [{ from: "2016-07-01", federal: 0.15 }, { from: FROM, federal: 0.13 }] },
  NS: { name: "Nova Scotia", federal: "HST", postal: "B", rates: [{ from: "2025-04-01", federal: 0.14 }, { from: FROM, federal: 0.15 }] },
  NT: { name: "Northwest Territories", federal: "GST", postal: "X", rates: gst() },
  NU: { name: "Nunavut", federal: "GST", postal: "X", rates: gst() },
  ON: { name: "Ontario", federal: "HST", postal: "KLMNP", rates: [{ from: FROM, federal: 0.13 }] },
  PE: { name: "Prince Edward Island", federal: "HST", postal: "C", rates: [{ from: "2016-10-01", federal: 0.15 }, { from: FROM, federal: 0.14 }] },
  QC: { name: "Quebec", federal: "GST", own: "QST", postal: "GHJ", rates: gst(0.09975) },
  SK: {
    name: "Saskatchewan", federal: "GST", own: "PST", postal: "S",
    rates: [{ from: "2017-03-23", federal: 0.05, own: 0.06 }, ...gst(0.05)],
  },
  YT: { name: "Yukon", federal: "GST", postal: "Y", rates: gst() },
};

export const isProvince = (code: string) => code.toUpperCase() in PROVINCES;

/** "m5v3l9" → "M5V 3L9"; null for anything that isn't a postal code. */
export function postalCode(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toUpperCase();
  if (!/^[ABCEGHJ-NPRSTVXY]\d[A-Z][ -]?\d[A-Z]\d$/.test(t)) return null;
  const c = t.replace(/[ -]/, "");
  return `${c.slice(0, 3)} ${c.slice(3)}`;
}

/** The province's parts on `date`. Throws RateError (422) for an earlier
 *  date, or a postal code that isn't the province's. */
export function provinceParts(code: string, date: string, zip?: string | null): RatePart[] {
  const p = PROVINCES[code];
  if (date < FROM) throw new RateError(`This service has Canada's rates only from ${FROM}.`, 422);
  const postal = postalCode(zip);
  if (zip && !postal) throw new RateError(`${zip} isn't a Canadian postal code.`, 422);
  if (postal && !p.postal.includes(postal[0]))
    throw new RateError(`Postal code ${postal} isn't in ${p.name}; the rate depends on the province. Check the address.`, 422);
  const r = p.rates.find((x) => x.from <= date)!;
  return [
    { kind: "state", name: p.federal === "HST" ? `${p.name} HST` : "GST", code: `CA:${p.federal}`, rate: r.federal, ids: {} },
    ...(p.own ? [{ kind: "state" as const, name: `${p.name} ${p.own}`, code: `${code}:${p.own}`, rate: r.own!, ids: {} }] : []),
  ];
}
