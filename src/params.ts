/**
 * The engine's tunable settings: numbers and switches that decide how sure
 * an answer must be, kept in one place so they can be tuned on the dev
 * splits rather than rewritten as rules. Each default is the best value
 * found so far; OTR_PARAMS (JSON) overrides any of them for a run, e.g.
 * OTR_PARAMS='{"agreeFactor":3}'. A setting it doesn't name, or a value of
 * the wrong kind, stops the process at start rather than run on a guess.
 * scripts/tuning runs the trials; keep development logs privately.
 */
import { MAP_STATES } from "./coverage.js";

export interface Params {
  /** Geocoders never asked, whatever keys are set (geocoding/registry.ts).
   *  On the dev splits Mapbox, HERE and Google stood in for one another,
   *  so Mapbox, the cheapest, is kept. */
  disabledGeocoders: string[];
  /** Pelias may return one house from several of its datasets (OpenAddresses,
   *  NAD, Overture): exact matches all within this many metres of its first
   *  are one answer, its margin widened to reach them; farther apart, they
   *  are different places (geocoding/providers/pelias.ts). */
  peliasDuplicateMetres: number;
  /** Two geocodes agree when no farther apart than this many times the
   *  larger of their margins (geocoding/agreement.ts)... */
  agreeFactor: number;
  /** ...and never farther apart than this. */
  agreeCapMetres: number;
  /** The smallest margin each accuracy class gets (geocoding/types.ts). */
  minMarginMetres: { rooftop: number; parcel: number; point: number; interpolated: number };
  /** An interpolated point (a guess along the street's house-number range)
   *  widens a more precise group's margin to reach it, and two of them can
   *  stand as a second place against it (geocoding/agreement.ts). Off, they
   *  only support a placement. Measured off on 2026-10-23 (dev, against a
   *  same-day baseline): one address more right, one more wrong (an
   *  unincorporated King County address the interpolated point kept out of
   *  Renton). Kept on. */
  interpolatedWidens: boolean;
  /** The widest circle disagreeing geocodes may be placed within
   *  (geocoding/locator.ts). */
  wideMetres: number;
  /** A lone dataset's point outside the typed city's outline is still
   *  trusted when it lies in the typed ZIP's Census area and in no other
   *  rated city: a rural address with a town's mailing name
   *  (geocoding/locator.ts). */
  lonePointOutsideCity: boolean;
  /** How far past its Census area an address with that ZIP may be, for an
   *  address no geocoder places (rates/map.ts). */
  zipMarginMetres: number;
  /** Square metres of a ZIP's widened area that may fall between the state's
   *  county outlines (slivers left by simplifying neighbours apart) and the
   *  counties still count as holding all of it (rates/map.ts). At 1,000 on
   *  2026-10-23: a Pennsylvania address 42 m² short of covered answered, no
   *  new wrong rate (dev, against a same-day baseline). */
  zipAreaGapSquareMetres: number;
  /** A map point this sure, agreed by two datasets, outweighs a street range
   *  (rates/ranges.ts). 0: the range that holds the house always answers
   *  (streetOverMap); at 40 the map overrode three right ranges on dev. */
  preciseMetres: number;
  /** Where a street range that holds this very house and the map point's
   *  outlines disagree, and the point isn't precise enough to outweigh the
   *  range (preciseMetres), the range answers; off, the address is declined
   *  (rates/ranges.ts). A house between listed ones still declines. On
   *  2026-10-23, with preciseMetres 0 (the range always outweighs the map
   *  point): dev 5,297 → 5,301 right, 7 → 4 wrong, 13 → 12 declined; eval
   *  1,986 → 1,990 right, 2 → 1 wrong, 11 → 8 declined, against same-day
   *  baselines. Five of those answers are the state's address database where
   *  its map says otherwise, counted right as the database is official. */
  streetOverMap: boolean;
  /** A point in a range state's tax zone for a town that the ZIP's file
   *  doesn't list and that levies nothing of its own takes the county's
   *  town-less area (rates/range-polygons.ts). */
  zoneBeyondZip: boolean;
  /** When a looked-up ZIP+4 and a state's own tax outlines disagree, the
   *  outlines answer; off, the address is declined locally so a state lookup
   *  can settle it, as outlines may be stale (rates/ranges.ts). */
  outlinesOverZip4: boolean;
  /** Taxes collected only by vendors located in their area, as "STATE:type"
   *  (rates/ranges.ts): left out of the rate on a sale delivered to an
   *  address there, and named in the answer's source. Wyoming's resort
   *  districts (type 69: Teton Village, Grand Targhee, 2%) are collected
   *  only by vendors physically in the district (WY Department of Revenue). */
  vendorOnlyTaxes: string[];
  /** How a state's own lookup (for the states STATE_LOOKUPS names) is used
   *  (rates/index.ts): "tiebreak" asks it only for an address the loaded
   *  data declines; "first" asks it before the loaded data, which answers
   *  only where the lookup can't. Missouri is always a tiebreak. */
  stateLookupAs: "tiebreak" | "first";
  /** When a state's lookup gives two rates across the point's margin, ask
   *  once for a sharper point and try again (rates/index.ts). */
  lookupSharpen: boolean;
  /** A state's lookup is asked only at a point this sure: it is read at the
   *  point and four edges of its margin, which can miss a town inside a
   *  wider one (rates/index.ts). */
  lookupMaxMarginMetres: number;
  /** An address inside an outline that adds nothing on the sale date, but
   *  whose jurisdiction's rate starts later, on the day its source first
   *  lists rates like it, is refused: whether it taxed on the date isn't
   *  known (rates/map.ts). On the boundary benchmark this is every wrong
   *  Texas answer for a past date: districts its loader knows only from the
   *  current quarter's list. */
  refuseBeforeFirstRate: boolean;
  /** A range state whose boundary file lists only the rows in force on its
   *  edition (Missouri's) answers no date before that edition from its
   *  ranges (rates/ranges.ts); its map and state lookup still may. On the
   *  history split, Missouri's ZIP-wide answers for past dates were wrong
   *  3 times in 17; its dated state lookup, 0 in 77. */
  refuseBeforeRangesListed: boolean;
  /** Where the address could be in another combination of jurisdictions
   *  with the same total rate, refuse it rather than answer the rate with
   *  its parts marked uncertain (rates/map.ts, rates/ranges.ts). */
  breakdownMustAgree: boolean;
  /** Metres added to a point's margin at a line, by map state, for how far
   *  a loaded outline may be from the state's own (rates/map.ts). Widens
   *  refusals as well as alternatives. Every map state is named; the
   *  boundary benchmark finds Texas's published outlines up to about 80 m
   *  from the Comptroller's own lookup: at a rooftop's margin, Texas at 0 m
   *  gives 15 wrong rates of 1,194 points near lines, 25 m gives 7 (and 94
   *  more refusals), 80 m gives 2; the address dev splits are unchanged at
   *  25 m. */
  outlineMarginMetres: Record<string, number>;
  /** Within this many metres of a line, a neighbour with the same rate but
   *  other jurisdictions is listed as an alternative, even beyond the
   *  point's margin (rates/map.ts). It only marks the breakdown uncertain;
   *  it never refuses a rate. On the boundary benchmark (TX, AZ, VA, SC,
   *  rooftop margin), 0 leaves 6 wrong breakdowns unmarked; 60 marks all of
   *  them, and marks 99 right ones uncertain as well (21 at 0). */
  breakdownMarginMetres: number;
  /** A misspelled street is read as another when this alike, and this far
   *  ahead of the next (rates/streets/correct.ts). */
  spellingMinSimilarity: number;
  spellingMinLead: number;
  /** describe= (taxability/describe.ts): the picker's probability a code,
   *  with its narrower kinds, needs before the text's code is used... */
  describeCodeAccept: number;
  /** ...and the probability a tax's cases that the rules treat alike need
   *  together before the text settles that tax as one of them. */
  describeConditionAccept: number;
  /** With no code accepted, the codes at or above this are candidates. */
  describeCandidateFloor: number;
  /** Whether a case that turns on a money amount ("totalling $4.00 or
   *  less", "a contract over $10,000") may be settled by a price the text
   *  states. Off: a price in a description isn't a transaction value (a
   *  line's price isn't the sale's total), so such cases stay open. */
  describeReadsAmounts: boolean;
  /** The same for a case that turns on how many units are sold ("in
   *  quantities of fewer than six", "four or more servings"): off, a count
   *  in the text never settles it. On held-out (2026-11-02) the picker read
   *  "one tart, two muffins, one cookie and two doughnuts" as fewer than
   *  six. */
  describeReadsCounts: boolean;
  /** For a question the first pick leaves open, ask each option as its own
   *  yes-or-no question: one established at describeBinaryAccept settles
   *  it, unless an option with another effect reaches describeBinaryVeto. */
  describeBinaryFallback: boolean;
  /** Tuned on dev half A (2026-11-02, frozen rules a4baa142): 0.9/0.9 was
   *  best there (+6 code, +3 text) but made fl-02 wrong on half B (a binary
   *  yes at 0.93), so it failed confirmation; 0.95/0.9, A's runner-up and
   *  the reviewers' prior, is kept, clean on both halves. A 0.95 veto made
   *  d2-mb-20 wrong on A. */
  describeBinaryAccept: number;
  describeBinaryVeto: number;
  /** The fallback's case stands only where the first pick leans no further
   *  to another effect. Added 2026-11-03 after d2-sk-13 (half A, under a
   *  stronger silence wording): the first pick put 0.85 on "feasibility
   *  studies" (exempt) and a yes of 0.96 on the residual "site-specific
   *  engineering" (taxable) settled it wrong. No dev answer changes with it
   *  now; kept as a guard. */
  describeFallbackAgree: boolean;
  /** With no one code, the codes whose answers here agree tax by tax are
   *  pooled; their probability together must reach describeCodePoolAccept. */
  /** Chosen on half A: 0.95 gave +9 text; 0.9 made d2-nt-04 wrong (a
   *  frozen shrimp ring pooled as groceries). Clean on half B. */
  describeCodePooling: boolean;
  describeCodePoolAccept: number;
  /** Whether a code whose settled rule lists exceptions may be pooled. Off
   *  (the first calibration) lost round 1's HVAC tune-up (repair and other
   *  professional service, both not taxed) and 4 dev text answers, and
   *  made nothing right; on, 0 wrong on every set. */
  describePoolExceptions: boolean;
  /** The reading fixes of 2026-11-03 (a blind sample of 50 receipt-style
   *  descriptions, graded against official sources: 3 wrong, r21 r30 r17),
   *  recalibrated the same day on fresh data: round 1 (120 blind
   *  descriptions, two graders) and a batch of 60 written to establish one
   *  rule case each. The first calibration (absolute 0.8 bars on Jev's
   *  yes-or-no answers, the silence wording on) lost 8 of round 1's answers
   *  both graders marked right and 10 of the batch's 48, every one a fact
   *  the text states ("a 12-pack of cola", "no plates or forks"). Measured
   *  on all of full dev (both modes), the 50, round 1 and the batch, every
   *  variant at 0 wrong but one noted below; frozen rules 4d44010, Jev
   *  1.14.0. Chosen: dev 943/803 right (main 935/795), the 50 at 0 wrong
   *  (main 3), round 1 62 right as main with none lost, the batch 48 with
   *  code and 35 without (main 48, 34).
   *
   *  A code read from the text whose definition turns on a fact (DEFINING
   *  in describe.ts: a soft drink is sweetened) is used only where the text
   *  establishes that fact: the mean yes over two wordings of the question
   *  (describeDefiningAsk "both": yes or unknown, and yes, not stated or
   *  contradicted) at this, yes at least as likely as not. Either wording
   *  alone mislabels something: the binary one gave the café's "cold brew
   *  and a breakfast sandwich" 0.48 and the deli tub's pasta salad (r17)
   *  0.36; the three-way one gave them 0.80 and 0.50. Their mean: 0.64 and
   *  0.43. At 0.4 r17 goes wrong; 0.6 loses one of the batch. */
  describeDefiningAccept: number;
  /** Round 2 also tried: dropping food.prepared's fact (6 rule-targeted
   *  h3 items come back, but r17 goes wrong: the check is its only
   *  guard); a SaaS fact (used remotely, nothing downloaded) for h1-39,
   *  which lost h1-02, b2-46 (a VPN plan) and b3-45 (app cloud storage),
   *  all graded right; facts for custom development and modification
   *  (h1-07 settles; 1 dev and 1 round-1 answer lost). None kept. */
  describeDefiningCheck: boolean;
  /** The defining question: "binary" (YES or UNKNOWN), "three" (YES,
   *  NOT_STATED or CONTRADICTED) or "both", their mean. "three" alone made
   *  r17 wrong (0.50); "binary" alone lost round 1's café order. */
  describeDefiningAsk: "binary" | "three" | "both";
  /** The open-case question tells the picker that a fact stated by its
   *  absence fits only where the text says so (SILENCE_INSTRUCTIONS). Off:
   *  it lowered the first pick on plainly stated cases (round 1's font
   *  download as used in the buyer's business 0.90 → 0.67, a furniture
   *  store's delivery as of taxable goods 0.91 → 0.85), and the absence
   *  question below keeps r21 open without it. On, every set lost answers
   *  (dev 943/803 → 933/790 at the chosen bars), wrong unchanged. */
  describeSilenceRule: boolean;
  /** Which accepted cases need confirming: "all", "negative" (a case whose
   *  words state a fact by its absence or a limit, "without utensils",
   *  "only cut": NEGATIVE in describe.ts), or "none". A negative case is
   *  confirmed by its yes-or-no question or by ABSENCE_INSTRUCTIONS's
   *  choice of three (the text states the absence in any words, is silent,
   *  or contradicts it), which reads "no plates or forks" as stated (0.79)
   *  where the yes-or-no question gave 0.48. "none" makes r21 wrong (a meal
   *  kit taken as sold without utensils); "all" cost 31 code and 37 text on
   *  dev under the first calibration. An unconfirmed negative case loses its
   *  weight to NONE, so the cases the rules treat alike with it still stand
   *  if they reach describeConditionAccept without it (round 1's zoning
   *  board retainer: legal, lobbying and a residual case, all not taxed). */
  /** Round 2 tried "all" with a three-way question per case (stated in
   *  any words, qualifiers included / silent / contradicted) at 0.5, to
   *  stop a case settling on a qualifier the text never names. It didn't
   *  (r17's "mixed by the seller" came out stated at 0.87, h2-45's
   *  "nonmechanical" repair too), and it cost dev 14 code and 22 text
   *  answers and round 1 six. */
  describeConfirm: "all" | "negative" | "none";
  /** A confirmation's yes: as likely as not. 0.4 scored the same; 0.6 lost
   *  2 dev and 1 of the batch; 0.8 (the first calibration) lost the
   *  stated absences. */
  describeConfirmAccept: number;
  /** Where the pick's top code is narrower than the code accepted and has
   *  a defining fact, the text establishing that fact at
   *  describeNarrowAccept establishes the narrower code (r27: a catered
   *  sandwich platter, platter at 0.75 of the pick, its fact at 0.95).
   *  +13 text on full dev, wrong unchanged. */
  describeNarrowByDefining: boolean;
  describeNarrowAccept: number;
  /** With no code at describeCodeAccept, the sole candidate: one code (with
   *  its kinds) holding describeSoleShare of all the codes' probability and
   *  at least describeSoleFloor, used if the text establishes its
   *  definition (its DEFINING fact, else its definition's own words)...
   *  It made no answer right on A or B at any setting tried, and made
   *  d2-nt-04 (A, share 0.9: a frozen shrimp ring as groceries), ny-24 (B,
   *  delivery at 0.82 with UNCLEAR 0.14) and d2-sk-18 (B, a tip read as the
   *  meal, NONE 0.3) wrong; it is kept at share 0.95, floor 0.8 and
   *  NONE + UNCLEAR at most 0.05, where it changes nothing on dev, for
   *  the receipt line the blind sample showed (r49: coffee beans, grocery
   *  the only candidate under 0.9). */
  /** Round 2 (2026-11-03) tried relaxing it to accept a code that leads:
   *  NONE at most 0.1, UNCLEAR at most 0.3, share 0.85 or 0.9, floor 0.6.
   *  Both made ny-24 and d2-nt-04 wrong again, and r42 (a made-to-order
   *  smoothie) wrong on the blind 50; the round-2 items it was meant for
   *  (whole-bean coffee at share 0.88, NONE 0.09; catering at UNCLEAR
   *  0.17; lobbying at UNCLEAR 0.28) can't be told from those by these
   *  caps, so it stays as it was. */
  describeSoleCandidate: boolean;
  describeSoleShare: number;
  describeSoleFloor: number;
  /** ...and only where NONE and UNCLEAR together are at most this. */
  describeSoleNone: number;
  /** A case the first pick puts under this names no need: its facts aren't
   *  what the answer turns on (r03: a sandwich's answer named the bakery
   *  cases' quantity_by_kind). */
  describeNeedsFloor: number;
  /** Whether the code question asks too if the line names several
   *  different items (ITEMS_QUESTION), and the probability of SEVERAL at
   *  which a code must have its fact established of every item named, or
   *  the entry asks for one item per request (needs one_item). Added
   *  2026-11-03 for baskets on one line (round 1: b3-01 groceries and a
   *  rotisserie chicken). Checking each item split out of the text cost 67
   *  dev text answers (a split loses the line's context); the every-item
   *  question costs 1 (803 → 802: la-08, one delivery fee on an invoice of
   *  mixed goods), round 1 two (b3-08 sparkling water and cola, by design;
   *  b3-35 a café's cold brew and sandwich, mean yes 0.45), 0 wrong
   *  anywhere; 0.95 scored the same. */
  describeItemsCheck: boolean;
  describeItemsAccept: number;
  /** Second models (OpenRouter ids), asked only where Jev's pick of a code
   *  or case is under its bar and at describeSecondFloor or more: every one
   *  must pick the same (withSecond, leadingCode in describe.ts). Empty:
   *  off, the default until a held-out round confirms it.
   *
   *  Measured 2026-11-03 on frozen dev (both modes), the blind 50, rounds
   *  1 and 2 and the b4 and h3 batches, Jev 1.14.0:
   *  - DeepSeek v4.1 flash alone, floor 0.6, codes and cases: dev text
   *    802 → 868 but 9 dev wrong (8 text, 1 code) and 3 of the 50.
   *  - DeepSeek and Gemini 3.8 flash both agreeing: 1 dev wrong (d2-nt-04, a
   *    shrimp ring as groceries, Jev 0.89), 3 of the 50 (r28 a settled
   *    rule's usual case lifted; r42 and r45).
   *  - Cases only, exceptions never lifted, floor 0.7: 0 wrong, but the
   *    lifted cases graders call unestablished came in (b3-20 "separately
   *    stated support", h1-16 "separately stated on the invoice", b2-56 a
   *    pizza "sold heated"); asking Jev three ways that the text states
   *    each part of a lifted case (CASE_INSTRUCTIONS) stops only b2-56.
   *  - Codes only (describeSecondCaseFloor 1), the lead holding 0.97 of
   *    the codes' probability (describeSecondShare: Jev's doubt is whether
   *    it's a code at all, not which; 0.95 the same), both models: 0 wrong
   *    everywhere; dev text 802 → 805, the 50 +1 (r23), round 1 +1 (b3-53,
   *    0%), round 2 +4 (h2-10 catering, h2-39 government affairs, all three
   *    graders; h2-31, h2-41, two of three). Chosen. 6.7% of the rounds'
   *    requests reach the band, each one code question to each model:
   *    about 0.13 calls and $0.0003 per request, $0.27 per 1,000. */
  describeSecond: string[];
  describeSecondFloor: number;
  /** Whether a code under the bar may be settled so; the floor for a case
   *  (describeSecondFloor is the code's; 1 is never); and the share of
   *  the codes' probability the code must hold. */
  describeSecondCodes: boolean;
  describeSecondCaseFloor: number;
  describeSecondShare: number;
}

const DEFAULTS: Params = {
  disabledGeocoders: ["google", "here"],
  peliasDuplicateMetres: 50,
  agreeFactor: 1,
  agreeCapMetres: 250,
  minMarginMetres: { rooftop: 15, parcel: 25, point: 40, interpolated: 75 },
  interpolatedWidens: true,
  wideMetres: 20_000,
  lonePointOutsideCity: true,
  zipMarginMetres: 2_000,
  zipAreaGapSquareMetres: 1_000,
  preciseMetres: 0,
  streetOverMap: true,
  zoneBeyondZip: true,
  outlinesOverZip4: false,
  vendorOnlyTaxes: ["WY:69"],
  stateLookupAs: "tiebreak",
  lookupSharpen: true,
  lookupMaxMarginMetres: 1_000,
  refuseBeforeFirstRate: true,
  breakdownMustAgree: false,
  refuseBeforeRangesListed: true,
  outlineMarginMetres: { ...Object.fromEntries(MAP_STATES.map((s) => [s, 0])), TX: 25 },
  breakdownMarginMetres: 60,
  spellingMinSimilarity: 0.45,
  spellingMinLead: 0.08,
  describeCodeAccept: 0.9,
  describeConditionAccept: 0.9,
  describeCandidateFloor: 0.05,
  describeReadsAmounts: false,
  describeReadsCounts: false,
  describeBinaryFallback: true,
  describeBinaryAccept: 0.95,
  describeBinaryVeto: 0.9,
  describeFallbackAgree: true,
  describeCodePooling: true,
  describeCodePoolAccept: 0.95,
  describePoolExceptions: true,
  describeDefiningAccept: 0.5,
  describeDefiningCheck: true,
  describeDefiningAsk: "both",
  describeSilenceRule: false,
  describeConfirm: "negative",
  describeConfirmAccept: 0.5,
  describeNarrowByDefining: true,
  describeNarrowAccept: 0.9,
  describeSoleCandidate: true,
  describeSoleShare: 0.95,
  describeSoleFloor: 0.8,
  describeSoleNone: 0.05,
  describeNeedsFloor: 0.05,
  describeItemsCheck: true,
  describeItemsAccept: 0.9,
  describeSecond: [],
  describeSecondFloor: 0.6,
  describeSecondCodes: true,
  describeSecondCaseFloor: 1,
  describeSecondShare: 0.97,
};

/** The value OTR_PARAMS gives `key`, or an error saying why it can't be. */
function checked(key: string, value: unknown, fallback: unknown): unknown {
  const fail = (why: string): never => { throw new Error(`OTR_PARAMS: ${key} ${why}`); };
  if (Array.isArray(fallback)) {
    if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) fail("must be a list of names");
    return value;
  }
  if (typeof fallback === "object" && fallback) {
    if (typeof value !== "object" || !value || Array.isArray(value)) fail("must be an object");
    const given = value as Record<string, unknown>;
    for (const k of Object.keys(given)) {
      if (!(k in fallback)) fail(`has no ${k}`);
      checked(`${key}.${k}`, given[k], (fallback as Record<string, unknown>)[k]);
    }
    return { ...fallback, ...given };
  }
  if (typeof value !== typeof fallback) fail(`must be a ${typeof fallback}`);
  if (typeof value === "number" && !(Number.isFinite(value) && value >= 0)) fail("must be a number of 0 or more");
  return value;
}

function read(): Params {
  const raw = process.env.OTR_PARAMS;
  const params = structuredClone(DEFAULTS) as unknown as Record<string, unknown>;
  if (!raw) return params as unknown as Params;
  let given: Record<string, unknown>;
  try {
    given = JSON.parse(raw);
  } catch {
    throw new Error("OTR_PARAMS isn't valid JSON");
  }
  const unknown = Object.keys(given).filter((k) => !(k in DEFAULTS));
  if (unknown.length) throw new Error(`OTR_PARAMS names unknown settings: ${unknown.join(", ")}`);
  for (const [key, value] of Object.entries(given)) params[key] = checked(key, value, params[key]);
  return params as unknown as Params;
}

/** Read once, at start; modules read it where they use it, so a test may
 *  change one for the rest of its file. */
export const PARAMS: Params = read();
