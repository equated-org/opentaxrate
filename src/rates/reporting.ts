/**
 * Where a seller files an address's tax: each state's revenue agency, the
 * return most sellers file there, and filing that goes around it
 * (self-collected cities, a remote sellers' program). A directory, the same
 * for every address in a state; the codes a return files the tax under are
 * each part's `ids` and the answer's `locationIds`, as the state's own data
 * gives them (names.ts, sales_tax_jurisdictions). `locationKey` names the
 * `locationIds` key a state's return files a location under, so a caller
 * reads it without knowing the state; the value itself is never changed
 * (Washington's four-digit Location Code is added beside the padded SER code).
 */
import type { AddressRate } from "./index.js";

export interface Reporting {
  /** Who the state's return goes to. */
  agency: { name: string; url: string };
  /** The return most sellers file there. */
  form: string | null;
  /** Filing that doesn't go through that return: self-collected cities, a
   *  separate program for remote sellers. */
  notes: string[];
  /** The `locationIds` key the return files the location under; null where
   *  the state's data gives none. */
  locationKey: string | null;
}

interface StateReporting {
  agency: string;
  url: string;
  form: string | null;
  notes?: string[];
  locationKey?: string;
}

/** Every state's revenue agency and the return a seller files there. */
export const STATE_REPORTING: Record<string, StateReporting> = {
  AL: {
    agency: "Alabama Department of Revenue",
    url: "https://www.revenue.alabama.gov/sales-use/",
    form: "Sales tax return (My Alabama Taxes)",
    notes: [
      "Some Alabama cities and counties collect their own tax; file those through ONE SPOT or with the locality.",
      "Eligible remote sellers may instead use the flat 8% Simplified Sellers Use Tax program.",
    ],
  },
  AK: {
    agency: "Alaska Remote Seller Sales Tax Commission",
    url: "https://arsstc.org/",
    form: null,
    notes: ["Alaska has no state sales tax. Remote sellers report member municipalities through the Commission; others file with each municipality."],
  },
  AZ: {
    agency: "Arizona Department of Revenue",
    url: "https://azdor.gov/business/transaction-privilege-tax",
    form: "TPT-2",
  },
  AR: {
    agency: "Arkansas Department of Finance and Administration",
    url: "https://www.dfa.arkansas.gov/office/taxes/excise-tax-administration/sales-use-tax/",
    form: "ET-1 with local supplemental schedule",
  },
  CA: {
    agency: "California Department of Tax and Fee Administration",
    url: "https://www.cdtfa.ca.gov/",
    form: "CDTFA-401 with Schedules A, B and C",
    locationKey: "Local Tax Area Code",
  },
  CO: {
    agency: "Colorado Department of Revenue",
    url: "https://tax.colorado.gov/sales-tax",
    form: "DR 0100",
    notes: ["Home-rule cities (Denver, Aurora, Boulder and others) collect their own tax; file with the city or through SUTS."],
  },
  CT: { agency: "Connecticut Department of Revenue Services", url: "https://portal.ct.gov/drs", form: "OS-114" },
  DE: {
    agency: "Delaware Division of Revenue",
    url: "https://revenue.delaware.gov/",
    form: null,
    notes: ["Delaware has no sales tax; sellers may owe its gross receipts tax instead."],
  },
  DC: { agency: "DC Office of Tax and Revenue", url: "https://otr.cfo.dc.gov/", form: "FR-800" },
  FL: {
    agency: "Florida Department of Revenue",
    url: "https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx",
    form: "DR-15",
  },
  GA: {
    agency: "Georgia Department of Revenue",
    url: "https://dor.georgia.gov/taxes/sales-use-tax",
    form: "ST-3",
  },
  HI: {
    agency: "Hawaii Department of Taxation",
    url: "https://tax.hawaii.gov/",
    form: "G-45 / G-49",
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
  },
  IN: { agency: "Indiana Department of Revenue", url: "https://www.in.gov/dor/", form: "ST-103" },
  IA: {
    agency: "Iowa Department of Revenue",
    url: "https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax",
    form: "Sales and use tax return",
  },
  KS: {
    agency: "Kansas Department of Revenue",
    url: "https://www.ksrevenue.gov/bustaxtypessales.html",
    form: "ST-36",
  },
  KY: { agency: "Kentucky Department of Revenue", url: "https://revenue.ky.gov/", form: "Sales and use tax return" },
  LA: {
    agency: "Louisiana Department of Revenue",
    url: "https://revenue.louisiana.gov/SalesTaxes",
    form: "R-1029",
    notes: [
      "Each parish collects its own local tax; Louisiana's combined return can send both.",
      "Qualifying remote sellers file state and local tax with the Louisiana Sales and Use Tax Commission for Remote Sellers instead.",
    ],
  },
  ME: { agency: "Maine Revenue Services", url: "https://www.maine.gov/revenue/", form: "ST-7" },
  MD: { agency: "Comptroller of Maryland", url: "https://www.marylandcomptroller.gov/", form: "Form 202" },
  MA: { agency: "Massachusetts Department of Revenue", url: "https://www.mass.gov/orgs/massachusetts-department-of-revenue", form: "ST-9" },
  MI: { agency: "Michigan Department of Treasury", url: "https://www.michigan.gov/taxes", form: "Sales, use and withholding return" },
  MN: {
    agency: "Minnesota Department of Revenue",
    url: "https://www.revenue.state.mn.us/sales-and-use-tax",
    form: "Sales and use tax return (e-Services)",
  },
  MS: {
    agency: "Mississippi Department of Revenue",
    url: "https://www.dor.ms.gov/sales-and-use-tax",
    form: "Sales tax return (TAP)",
  },
  MO: {
    agency: "Missouri Department of Revenue",
    url: "https://dor.mo.gov/taxation/business/tax-types/sales-use/",
    form: "Form 53-1",
    locationKey: "Jurisdiction Code",
  },
  MT: {
    agency: "Montana Department of Revenue",
    url: "https://mtrevenue.gov/",
    form: null,
    notes: ["Montana has no general sales tax; resort towns and areas collect their own resort tax."],
  },
  NE: {
    agency: "Nebraska Department of Revenue",
    url: "https://revenue.nebraska.gov/businesses/sales-and-use-tax",
    form: "Form 10 with Schedule I",
  },
  NV: {
    agency: "Nevada Department of Taxation",
    url: "https://tax.nv.gov/tax-types/sales-tax-use-tax/",
    form: "Sales and use tax return",
  },
  NH: { agency: "New Hampshire Department of Revenue Administration", url: "https://www.revenue.nh.gov/", form: null },
  NJ: { agency: "New Jersey Division of Taxation", url: "https://www.nj.gov/treasury/taxation/", form: "ST-50" },
  NM: {
    agency: "New Mexico Taxation and Revenue Department",
    url: "https://www.tax.newmexico.gov/businesses/gross-receipts-overview/",
    form: "TRD-41413",
  },
  NY: {
    agency: "New York State Department of Taxation and Finance",
    url: "https://www.tax.ny.gov/bus/st/stidx.htm",
    form: "ST-100 / ST-101",
  },
  NC: {
    agency: "North Carolina Department of Revenue",
    url: "https://www.ncdor.gov/taxes-forms/sales-and-use-tax",
    form: "E-500 with E-536",
  },
  ND: {
    agency: "North Dakota Office of State Tax Commissioner",
    url: "https://www.tax.nd.gov/business/sales-and-use-tax",
    form: "Sales, use and gross receipts tax return",
  },
  OH: {
    agency: "Ohio Department of Taxation",
    url: "https://tax.ohio.gov/business/sales-and-use-tax",
    form: "UST-1",
  },
  OK: {
    agency: "Oklahoma Tax Commission",
    url: "https://oklahoma.gov/tax/businesses/sales-use.html",
    form: "Sales tax return (OkTAP)",
  },
  OR: { agency: "Oregon Department of Revenue", url: "https://www.oregon.gov/dor/", form: null },
  PA: {
    agency: "Pennsylvania Department of Revenue",
    url: "https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax",
    form: "Sales, use and hotel occupancy tax return (myPATH)",
  },
  RI: { agency: "Rhode Island Division of Taxation", url: "https://tax.ri.gov/", form: "Sales and use tax return" },
  SC: {
    agency: "South Carolina Department of Revenue",
    url: "https://dor.sc.gov/tax/sales",
    form: "ST-3 with ST-389",
    notes: ["Cities and counties collect their own hospitality taxes."],
  },
  SD: {
    agency: "South Dakota Department of Revenue",
    url: "https://dor.sd.gov/businesses/taxes/sales-use-tax/",
    form: "Sales and use tax return",
  },
  TN: {
    agency: "Tennessee Department of Revenue",
    url: "https://www.tn.gov/revenue/taxes/sales-and-use-tax.html",
    form: "SLS 450",
  },
  TX: {
    agency: "Texas Comptroller of Public Accounts",
    url: "https://comptroller.texas.gov/taxes/sales/",
    form: "Texas sales and use tax return",
  },
  UT: {
    agency: "Utah State Tax Commission",
    url: "https://tax.utah.gov/sales",
    form: "TC-62S / TC-62M",
  },
  VT: {
    agency: "Vermont Department of Taxes",
    url: "https://tax.vermont.gov/business/sales-and-use-tax",
    form: "SUT-451",
  },
  VA: {
    agency: "Virginia Tax",
    url: "https://www.tax.virginia.gov/retail-sales-and-use-tax",
    form: "ST-1",
  },
  WA: {
    agency: "Washington Department of Revenue",
    url: "https://dor.wa.gov/taxes-rates/sales-use-tax-rates",
    form: "Combined Excise Tax Return",
    locationKey: "Location Code",
  },
  WV: {
    agency: "West Virginia Tax Division",
    url: "https://tax.wv.gov/Business/SalesAndUseTax/",
    form: "CST-200CU with Schedule M",
  },
  WI: {
    agency: "Wisconsin Department of Revenue",
    url: "https://www.revenue.wi.gov/Pages/Businesses/sales-and-use-tax.aspx",
    form: "ST-12 with Schedule CT",
  },
  WY: {
    agency: "Wyoming Department of Revenue",
    url: "https://excise-tax-div.wyo.gov/",
    form: "Sales and use tax return",
  },
};

const CRA = {
  agency: "Canada Revenue Agency",
  url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses.html",
  form: "GST/HST return (GST34)",
};

/** Canada's provinces: the GST/HST return goes to the CRA, with a province's
 *  own tax filed apart, except in Quebec, where Revenu Québec takes both. */
export const PROVINCE_REPORTING: Record<string, StateReporting> = {
  ...Object.fromEntries(["AB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "YT"].map((p) => [p, CRA])),
  BC: { ...CRA, notes: ["British Columbia's PST is filed separately with the BC Ministry of Finance, through eTaxBC."] },
  MB: { ...CRA, notes: ["Manitoba's RST is filed separately with Manitoba Finance, through TAXcess."] },
  SK: { ...CRA, notes: ["Saskatchewan's PST is filed separately with the Ministry of Finance, through Saskatchewan eTax Services."] },
  QC: { agency: "Revenu Québec", url: "https://www.revenuquebec.ca/en/businesses/consumption-taxes/gsthst-and-qst/", form: "GST/HST and QST return (FPZ-500)" },
};

/** The state's or province's agency, return and filing notes; null for a
 *  state with no entry. */
export function reportingFor(state: AddressRate["state"]): Reporting | null {
  const info = STATE_REPORTING[state] ?? PROVINCE_REPORTING[state];
  if (!info) return null;
  return { agency: { name: info.agency, url: info.url }, form: info.form, notes: info.notes ?? [], locationKey: info.locationKey ?? null };
}
