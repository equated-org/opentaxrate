/**
 * What a seller needs to report an address's tax: who the state return goes
 * to, the codes it files the address's local tax under, and how sure we are
 * of each. One shape for every state; what fills it differs:
 *
 *   - States with no local tax on the general return (Connecticut, Indiana,
 *     no-tax states): nothing to code; `status: "not_needed"`.
 *   - States whose own files carry the return's code: Washington's location
 *     code (its Streamlined boundary file's composite SER column), Missouri's
 *     jurisdiction code, Texas's local authority codes, New Mexico's GRT
 *     location code, California's tax area code.
 *   - The rest: the return asks for a code we don't map yet (Georgia's ST-3
 *     jurisdiction code, Ohio's UST-1 county code, ...); `status: "partial"`,
 *     and `missing` names it. A Census FIPS code is never passed off as one.
 *
 * A code is `verified` only where we checked that its value is what the
 * return asks for; an unverified one is the state's own code, offered for
 * matching against the return's list. Codes a seller's own account holds
 * (Arizona's business location code, a Texas outlet number) can't come from
 * an address, and are named in `missing`.
 */
import type { AddressRate, RatePart } from "./index.js";

export interface ReportingCode {
  /** Which list the value is from, e.g. "wa-dor-location", "sst-ser". */
  scheme: string;
  /** What the return or file calls it. */
  label: string;
  value: string;
  /** The `code`s of the parts it reports. */
  parts: string[];
  /** We checked this value is the one the return asks for. */
  verified: boolean;
}

export interface Reporting {
  /** "complete": every code the state return needs for this address's local
   *  tax is here and verified. "not_needed": the return files no local
   *  code. "partial": some are missing or unverified (see `missing`). */
  status: "complete" | "partial" | "not_needed";
  /** Who the state's return goes to. */
  agency: { name: string; url: string };
  /** The return most sellers file there. */
  form: string | null;
  codes: ReportingCode[];
  /** Codes the return needs for this address that this answer doesn't
   *  give. */
  missing: string[];
  /** What the return needs from the seller's own registration, which no
   *  address can give: Arizona's business location code, a Texas outlet. */
  fromAccount: string[];
  /** Filing that doesn't follow from the code: self-collected cities, a
   *  separate program for remote sellers. */
  notes: string[];
}

interface StateReporting {
  agency: string;
  url: string;
  form: string | null;
  /** The return files no local code: one rate statewide, or no sales tax. */
  noLocal?: true;
  /** What the return asks local tax under, where we don't give it yet. */
  needs?: string;
  /** What it asks from the seller's own registration. */
  account?: string;
  notes?: string[];
}

/** Every state's revenue agency and the return a seller files there. */
export const STATE_REPORTING: Record<string, StateReporting> = {
  AL: {
    agency: "Alabama Department of Revenue",
    url: "https://www.revenue.alabama.gov/sales-use/",
    form: "Sales tax return (My Alabama Taxes)",
    needs: "Alabama locality code for each state-administered local tax",
    notes: [
      "Some Alabama cities and counties collect their own tax; file those through ONE SPOT or with the locality.",
      "Eligible remote sellers may instead use the flat 8% Simplified Sellers Use Tax program.",
    ],
  },
  AK: {
    agency: "Alaska Remote Seller Sales Tax Commission",
    url: "https://arsstc.org/",
    form: null,
    needs: "the municipality the Commission reports it under",
    notes: ["Alaska has no state sales tax. Remote sellers report member municipalities through the Commission; others file with each municipality."],
  },
  AZ: {
    agency: "Arizona Department of Revenue",
    url: "https://azdor.gov/business/transaction-privilege-tax",
    form: "TPT-2",
    account: "your business location code from your TPT license, and your business (activity) code",
  },
  AR: {
    agency: "Arkansas Department of Finance and Administration",
    url: "https://www.dfa.arkansas.gov/office/taxes/excise-tax-administration/sales-use-tax/",
    form: "ET-1 with local supplemental schedule",
    needs: "Arkansas's city and county codes for the local supplemental schedule",
  },
  CA: {
    agency: "California Department of Tax and Fee Administration",
    url: "https://www.cdtfa.ca.gov/",
    form: "CDTFA-401 with Schedules A, B and C",
    needs: "Schedule A district codes and Schedule B county allocation, which the tax area code alone doesn't give",
  },
  CO: {
    agency: "Colorado Department of Revenue",
    url: "https://tax.colorado.gov/sales-tax",
    form: "DR 0100",
    needs: "Colorado's jurisdiction code (DR 0800) for each state-collected local tax",
    notes: ["Home-rule cities (Denver, Aurora, Boulder and others) collect their own tax; file with the city or through SUTS."],
  },
  CT: { agency: "Connecticut Department of Revenue Services", url: "https://portal.ct.gov/drs", form: "OS-114", noLocal: true },
  DE: {
    agency: "Delaware Division of Revenue",
    url: "https://revenue.delaware.gov/",
    form: null,
    noLocal: true,
    notes: ["Delaware has no sales tax; sellers may owe its gross receipts tax instead."],
  },
  DC: { agency: "DC Office of Tax and Revenue", url: "https://otr.cfo.dc.gov/", form: "FR-800", noLocal: true },
  FL: {
    agency: "Florida Department of Revenue",
    url: "https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx",
    form: "DR-15",
    needs: "the county for discretionary sales surtax (DR-15 surtax lines)",
  },
  GA: {
    agency: "Georgia Department of Revenue",
    url: "https://dor.georgia.gov/taxes/sales-use-tax",
    form: "ST-3",
    needs: "Georgia's ST-3 jurisdiction code",
  },
  HI: {
    agency: "Hawaii Department of Taxation",
    url: "https://tax.hawaii.gov/",
    form: "G-45 / G-49",
    needs: "the taxation district for the county surcharge",
  },
  ID: {
    agency: "Idaho State Tax Commission",
    url: "https://tax.idaho.gov/taxes/sales-use/",
    form: "Sales and use tax return",
    notes: ["Resort cities collect their own local tax; file that with the city."],
  },
  IL: {
    agency: "Illinois Department of Revenue",
    url: "https://tax.illinois.gov/research/taxinformation/sales.html",
    form: "ST-1 / ST-2",
    account: "the location as registered on your ST-2",
  },
  IN: { agency: "Indiana Department of Revenue", url: "https://www.in.gov/dor/", form: "ST-103", noLocal: true },
  IA: {
    agency: "Iowa Department of Revenue",
    url: "https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax",
    form: "Sales and use tax return",
    needs: "the county the local option tax is reported under",
  },
  KS: {
    agency: "Kansas Department of Revenue",
    url: "https://www.ksrevenue.gov/bustaxtypessales.html",
    form: "ST-36",
    needs: "Kansas's ST-36 jurisdiction code (KS-1700)",
  },
  KY: { agency: "Kentucky Department of Revenue", url: "https://revenue.ky.gov/", form: "Sales and use tax return", noLocal: true },
  LA: {
    agency: "Louisiana Department of Revenue",
    url: "https://revenue.louisiana.gov/SalesTaxes",
    form: "R-1029",
    needs: "the parish's local collector and its account",
    notes: [
      "Each parish collects its own local tax; Louisiana's combined return can send both.",
      "Qualifying remote sellers file state and local tax with the Louisiana Sales and Use Tax Commission for Remote Sellers instead.",
    ],
  },
  ME: { agency: "Maine Revenue Services", url: "https://www.maine.gov/revenue/", form: "ST-7", noLocal: true },
  MD: { agency: "Comptroller of Maryland", url: "https://www.marylandcomptroller.gov/", form: "Form 202", noLocal: true },
  MA: { agency: "Massachusetts Department of Revenue", url: "https://www.mass.gov/orgs/massachusetts-department-of-revenue", form: "ST-9", noLocal: true },
  MI: { agency: "Michigan Department of Treasury", url: "https://www.michigan.gov/taxes", form: "Sales, use and withholding return", noLocal: true },
  MN: {
    agency: "Minnesota Department of Revenue",
    url: "https://www.revenue.state.mn.us/sales-and-use-tax",
    form: "Sales and use tax return (e-Services)",
    needs: "Minnesota's tax type code for each local tax",
  },
  MS: {
    agency: "Mississippi Department of Revenue",
    url: "https://www.dor.ms.gov/sales-and-use-tax",
    form: "Sales tax return (TAP)",
    needs: "Mississippi's city and county code for each local levy",
  },
  MO: {
    agency: "Missouri Department of Revenue",
    url: "https://dor.mo.gov/taxation/business/tax-types/sales-use/",
    form: "Form 53-1",
    account: "your site code, from your Missouri registration",
  },
  MT: {
    agency: "Montana Department of Revenue",
    url: "https://mtrevenue.gov/",
    form: null,
    noLocal: true,
    notes: ["Montana has no general sales tax; resort towns and areas collect their own resort tax."],
  },
  NE: {
    agency: "Nebraska Department of Revenue",
    url: "https://revenue.nebraska.gov/businesses/sales-and-use-tax",
    form: "Form 10 with Schedule I",
    needs: "Nebraska's Schedule I city or county code",
  },
  NV: {
    agency: "Nevada Department of Taxation",
    url: "https://tax.nv.gov/tax-types/sales-tax-use-tax/",
    form: "Sales and use tax return",
    needs: "the county row the return reports it under",
  },
  NH: { agency: "New Hampshire Department of Revenue Administration", url: "https://www.revenue.nh.gov/", form: null, noLocal: true },
  NJ: { agency: "New Jersey Division of Taxation", url: "https://www.nj.gov/treasury/taxation/", form: "ST-50", noLocal: true },
  NM: {
    agency: "New Mexico Taxation and Revenue Department",
    url: "https://www.tax.newmexico.gov/businesses/gross-receipts-overview/",
    form: "TRD-41413",
  },
  NY: {
    agency: "New York State Department of Taxation and Finance",
    url: "https://www.tax.ny.gov/bus/st/stidx.htm",
    form: "ST-100 / ST-101",
    needs: "the ST-100 jurisdiction reporting code",
  },
  NC: {
    agency: "North Carolina Department of Revenue",
    url: "https://www.ncdor.gov/taxes-forms/sales-and-use-tax",
    form: "E-500 with E-536",
    needs: "the county on Form E-536",
  },
  ND: {
    agency: "North Dakota Office of State Tax Commissioner",
    url: "https://www.tax.nd.gov/business/sales-and-use-tax",
    form: "Sales, use and gross receipts tax return",
    needs: "North Dakota's local tax code",
  },
  OH: {
    agency: "Ohio Department of Taxation",
    url: "https://tax.ohio.gov/business/sales-and-use-tax",
    form: "UST-1",
    needs: "Ohio's UST-1 county code (not the Census county code)",
  },
  OK: {
    agency: "Oklahoma Tax Commission",
    url: "https://oklahoma.gov/tax/businesses/sales-use.html",
    form: "Sales tax return (OkTAP)",
    needs: "Oklahoma's city and county tax codes",
  },
  OR: { agency: "Oregon Department of Revenue", url: "https://www.oregon.gov/dor/", form: null, noLocal: true },
  PA: {
    agency: "Pennsylvania Department of Revenue",
    url: "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax",
    form: "Sales, use and hotel occupancy tax return (myPATH)",
    needs: "the local tax line (Allegheny County or Philadelphia), where one applies",
  },
  RI: { agency: "Rhode Island Division of Taxation", url: "https://tax.ri.gov/", form: "Sales and use tax return", noLocal: true },
  SC: {
    agency: "South Carolina Department of Revenue",
    url: "https://dor.sc.gov/tax/sales",
    form: "ST-3 with ST-389",
    needs: "South Carolina's four-digit ST-389 county or city code and local tax category",
    notes: ["Cities and counties collect their own hospitality taxes."],
  },
  SD: {
    agency: "South Dakota Department of Revenue",
    url: "https://dor.sd.gov/businesses/taxes/sales-use-tax/",
    form: "Sales and use tax return",
    needs: "South Dakota's municipal tax code",
  },
  TN: {
    agency: "Tennessee Department of Revenue",
    url: "https://www.tn.gov/revenue/taxes/sales-and-use-tax.html",
    form: "SLS 450",
    needs: "the local jurisdiction on Schedule B",
    account: "your location ID",
  },
  TX: {
    agency: "Texas Comptroller of Public Accounts",
    url: "https://comptroller.texas.gov/taxes/sales/",
    form: "Texas sales and use tax return",
    account: "your outlet number, from your Texas permit",
  },
  UT: {
    agency: "Utah State Tax Commission",
    url: "https://tax.utah.gov/sales",
    form: "TC-62S / TC-62M",
    needs: "Utah's location code (Publication 25)",
  },
  VT: {
    agency: "Vermont Department of Taxes",
    url: "https://tax.vermont.gov/business/sales-and-use-tax",
    form: "SUT-451",
    needs: "the municipality for local option tax",
  },
  VA: {
    agency: "Virginia Tax",
    url: "https://www.tax.virginia.gov/retail-sales-and-use-tax",
    form: "ST-1",
    needs: "Virginia's locality code",
  },
  WA: {
    agency: "Washington Department of Revenue",
    url: "https://dor.wa.gov/taxes-rates/sales-use-tax-rates",
    form: "Combined Excise Tax Return",
  },
  WV: {
    agency: "West Virginia Tax Division",
    url: "https://tax.wv.gov/Business/SalesAndUseTax/",
    form: "CST-200CU with Schedule M",
    needs: "West Virginia's Schedule M municipal code",
  },
  WI: {
    agency: "Wisconsin Department of Revenue",
    url: "https://www.revenue.wi.gov/Pages/Businesses/sales-and-use-tax.aspx",
    form: "ST-12 with Schedule CT",
    needs: "Wisconsin's Schedule CT county code",
  },
  WY: {
    agency: "Wyoming Department of Revenue",
    url: "https://excise-tax-div.wyo.gov/",
    form: "Sales and use tax return",
    needs: "Wyoming's county locality code",
  },
};

/** Codes a state's own data gives each part, by the part's code prefix. */
const PART_CODES: Record<string, { scheme: string; label: string; verified: boolean; types?: string[] }> = {
  // Texas: every local part is keyed by its 7-digit local authority code.
  TX: { scheme: "tx-local-code", label: "Local code", verified: true },
  // New Mexico: its GRT location code ("01-001").
  NM: { scheme: "nm-grt-location", label: "GRT location code", verified: true },
  // Arizona: region code for a county, city code for a city, from its rate table.
  AZ: { scheme: "az-tpt-region-city", label: "Region or city code", verified: false },
  // Illinois: IDOR's location code, without the check digit the ST-2 shows.
  IL: { scheme: "il-idor-location", label: "Location code (without check digit)", verified: false },
};

/** States whose own data gives the return's code, and what it's called
 *  when an answer can't settle one. */
const OWN_CODE: Record<string, string> = {
  WA: "Washington's location code (this address matched more than one area)",
  MO: "Missouri's jurisdiction code (this address matched more than one area)",
  CA: "California's tax area code",
  TX: "Texas's local codes",
  NM: "New Mexico's GRT location code",
};

/** The reporting for an answer. `reportingCode` is the code a range state's
 *  boundary file filed the address under (its composite SER column, or
 *  Missouri's jurisdiction code). */
export function reportingFor(
  state: string,
  match: AddressRate["match"],
  parts: RatePart[],
  locationCode: string | null,
  reportingCode: string | null | undefined,
): Reporting | null {
  const info = STATE_REPORTING[state];
  if (!info) return null;
  const local = parts.filter((p) => p.kind !== "state" && p.rate !== 0);
  const localCodes = local.map((p) => p.code);
  const codes: ReportingCode[] = [];

  if (state === "WA" && reportingCode) {
    // The SER column zero-pads the DOR's four-digit location code; the one
    // code reports the state and local parts together.
    codes.push({ scheme: "wa-dor-location", label: "Location code", value: reportingCode.replace(/^0(?=\d{4}$)/, ""), parts: parts.map((p) => p.code), verified: true });
  } else if (state === "MO" && reportingCode) {
    codes.push({ scheme: "mo-dor-jurisdiction", label: "Jurisdiction code", value: reportingCode, parts: localCodes, verified: false });
  } else if (state === "CA" && locationCode) {
    codes.push({ scheme: "ca-cdtfa-tac", label: "Tax area code", value: locationCode, parts: localCodes, verified: true });
  } else if (reportingCode) {
    // Another Streamlined state's composite SER code (Kansas's): its own
    // code, not yet checked against its return's list.
    codes.push({ scheme: "sst-ser", label: "Composite SER code", value: reportingCode, parts: localCodes, verified: false });
  }
  const partCodes = PART_CODES[state];
  // A state lookup's single "district" part has no code of the state's own.
  if (partCodes && match !== "authority")
    for (const p of local) {
      // A combined area's code ("kx:2227016>3227999") reports its last authority.
      const value = p.code.split(/[:>]/).pop()!;
      codes.push({ scheme: partCodes.scheme, label: partCodes.label, value, parts: [p.code], verified: partCodes.verified });
    }

  const noLocal = local.length === 0;
  const missing: string[] = [];
  if (!noLocal) {
    if (info.needs) missing.push(info.needs);
    if (OWN_CODE[state] && !codes.length) missing.push(OWN_CODE[state]);
  }
  const status: Reporting["status"] =
    noLocal && !codes.length
      ? "not_needed"
      : !missing.length && codes.length && codes.every((c) => c.verified)
        ? "complete"
        : "partial";
  return {
    status,
    agency: { name: info.agency, url: info.url },
    form: info.form,
    codes,
    missing,
    fromAccount: info.account ? [info.account] : [],
    notes: info.notes ?? [],
  };
}
