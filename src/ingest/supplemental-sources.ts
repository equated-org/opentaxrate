/**
 * The list of supplemental polygon layers supplemental.ts downloads, found
 * in the nationwide source audit, each with its role: a tax area that
 * verify-polygons.ts may index, a civil boundary or validation layer kept
 * only as evidence, or a conditional charge left out of the general rate.
 * Also the known gaps: sources still needed, and why they aren't loaded.
 * None of these layers' rate attributes replaces a dated rate table.
 */
export interface PolygonSource {
  id: string;
  state: string;
  url: string;
  role: "tax-area" | "civil-boundary" | "conditional-charge" | "validation";
  note: string;
  where?: string;
  /** Historical services contain many complete editions. The regular
   * refresh indexes the newest edition; older snapshots remain preserved. */
  latestDateField?: string;
  /** Some official layers include attribute-only placeholder records. Keep
   * those in snapshot metadata, never interpret them as zero-tax areas. */
  allowMissingGeometry?: boolean;
}

const ca = "https://services6.arcgis.com/snwvZ3EmaoXJiugR/arcgis/rest/services";
const mn = "https://services9.arcgis.com/LLh6i97mwBitl1k5/arcgis/rest/services";
const sd = "https://sdgis.sd.gov/host/rest/services/Hosted";
const tn = "https://tnmap.tn.gov/arcgis/rest/services/COMMUNITY/SST/MapServer";
const ar = "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Boundaries/FeatureServer";
const ut = "https://services1.arcgis.com/99lidPhWCzftIe9K/ArcGIS/rest/services";

export const SUPPLEMENTAL_POLYGONS: PolygonSource[] = [
  { id: "ca-tax-areas", state: "CA", url: `${ca}/California_Sales_and_Use_Tax_Rates/FeatureServer/1`, role: "tax-area", note: "Quarter from DateStamp; RATE is a total, not an additive district rate." },
  { id: "ca-tax-history", state: "CA", url: `${ca}/CA_SalesandUsetaxRates_2017toPresent/FeatureServer/0`, role: "tax-area", latestDateField: "DateStamp", note: "Service contains quarterly geometries from 2017. Refresh acquires the latest DateStamp; START_DATE alone does not date geometry. Older quarters require a historical backfill." },
  { id: "mn-tax-areas", state: "MN", url: `${mn}/locgnrl_sales_usetax_areas_2026Q4/FeatureServer/0`, role: "tax-area", note: "2026Q4 combined areas; crosswalk sst_code and component codes before promotion." },
  { id: "ne-tax-areas", state: "NE", url: "https://gis.ne.gov/agency3/rest/services/SalesTaxWebLayerREV/FeatureServer/0", role: "tax-area", note: "Nested state/county/city/Good Life districts; decimal and percent fields differ. GLD requires transaction rules." },
  { id: "ia-local-option", state: "IA", url: "https://geoservices.iowa.gov/arcgis/rest/services/revenue/SalesTaxRates/FeatureServer/1", role: "tax-area", allowMissingGeometry: true, note: "Reconcile dates/rates with current DOR LOST status spreadsheet; geometry attributes can be stale. Attribute-only placeholders are retained in metadata, not mapped as tax-free." },
  { id: "sd-cities", state: "SD", url: `${sd}/citys_joined2/FeatureServer/0`, role: "tax-area", note: "General, BBB, reservation and special rates have different scopes; do not sum every rate field." },
  { id: "sd-special-districts", state: "SD", url: `${sd}/Special_Tax_Districts/FeatureServer/0`, role: "conditional-charge", note: "Tribal and special jurisdiction treatment depends on transaction/customer status." },
  { id: "vt-local-option", state: "VT", url: "https://services1.arcgis.com/BkFxaEFNwHqX3tAw/arcgis/rest/services/VT%20Data%20-%20Local%20Option%20Tax%20Rates%20-%20WM/FeatureServer/0", role: "tax-area", note: "Town GEOID crosswalk; sales, meals/alcohol and rooms have separate dates and scope." },
  { id: "tn-cbid-2026", state: "TN", url: `${tn}/5`, role: "conditional-charge", note: "2026 boundary; qualifying CBID fee is not a blanket general sales tax." },
  { id: "tn-cbid-2027", state: "TN", url: `${tn}/6`, role: "conditional-charge", note: "Future boundary effective 2027-01-01; keep separate from 2026." },
  { id: "tn-cities", state: "TN", url: `${tn}/2`, role: "civil-boundary", note: "Crosswalk legal municipalities to SST codes and tax-effective annexations." },
  { id: "tn-counties", state: "TN", url: `${tn}/3`, role: "civil-boundary", note: "Official county geometry; rates remain dated SST records." },
  { id: "ar-municipalities", state: "AR", url: `${ar}/41`, role: "civil-boundary", note: "Legal municipal outlines; civil effective date may differ from tax effective date." },
  { id: "ar-municipal-changes", state: "AR", url: `${ar}/42`, role: "civil-boundary", note: "Annexation instruments and effective dates; changes are not complete city outlines." },
  { id: "va-tax-crosscheck", state: "VA", url: "https://services7.arcgis.com/uqPgn4wEg9kvR2OC/arcgis/rest/services/DetailedCountyforLookupSearchPopup/FeatureServer/4", role: "validation", note: "Validate current workbook/county joins; GIS rate attributes can lag." },
  { id: "wv-communities", state: "WV", url: "https://services.wvgis.wvu.edu/arcgis/rest/services/Boundaries/wv_political_boundary/MapServer/1", role: "civil-boundary", note: "Includes unincorporated communities; only DOR-listed taxing municipalities qualify." },
  { id: "ut-transit", state: "UT", url: `${ut}/TransitSpecialTaxAreas/FeatureServer/0`, role: "validation", note: "Transit can already be included in general rates; never add a second time." },
  { id: "al-montgomery-pj", state: "AL", url: "https://gis.montgomeryal.gov/server/rest/services/OneView/Police_Jurisdiction/MapServer/4", role: "conditional-charge", note: "Local coverage only; confirm levy/ordinance and dates, police coverage alone does not establish a tax." },
];

/** Acquisition gaps are explicit, not successful empty datasets. Existing
 * native adapters (TX, IL, AZ, NM, LA/EBR, etc.) continue in refresh. */
export const SOURCE_ACQUISITION_GAPS = [
  ["AL", "Other police jurisdictions", "Annual official PDF/JPG maps need georeferencing and levy/ordinance reconciliation", "https://www.revenue.alabama.gov/sales-use/police-jurisdictions/"],
  ["KS", "CID/TDD/STAR districts", "County exports and KDOR reporting-code crosswalk; no verified statewide public bulk layer", "https://ksrevenue.gov/webservices.html"],
  ["LA", "Parish tax domiciles outside EBR", "Supported bulk export/access agreement; public lookup uses CAPTCHA", "https://rates.salestaxportal.com/public"],
  ["FL", "PointMatch address database", "Qualified-user bulk access workflow", "https://pointmatch.floridarevenue.com/User/Display.aspx"],
  ["MO", "Post-2023 districts", "Archive lacks current districts; obtain current local/state exports; retain official lookup fallback", "https://dor.mo.gov/taxation/business/tax-types/sales-use/rate-tables/"],
  ["IL", "Remaining business-district polygons", "Exact-address files already loaded; complete statewide district geometry export not verified", "https://tax.illinois.gov/research/taxinformation/sales/busdistrict.html"],
  ["MT", "Resort districts / West Yellowstone rate", "Obtain missing boundaries and reconcile effective date of town 4% versus stale DOR 3%", "https://www.townofwestyellowstone.com/resort-tax-information/"],
  ["ID", "Resort districts", "Local ordinances, boundary exports and product scope; property-tax GIS is not a sales-tax layer", "https://tax.idaho.gov/taxes/sales-use/"],
  ["WY", "Teton Village resort district", "Local district geometry and vendor-location rule", "https://tetonvillagewy.gov/district-government/teton-village-districts/resort-district-tvrd/"],
] as const;
