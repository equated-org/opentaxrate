/**
 * The local parts whose tax the state doesn't administer: home-rule cities
 * that collect their own sales tax. A rule keyed "XX:administered" (the
 * state part and the local taxes the state administers) never decides one
 * of these parts, so where it has no rule of its own (or an "XX:local"
 * one) such a part isn't researched, rather than answered by the state's
 * treatment (Colorado's software rules from 2027, which the Department
 * says don't apply to the home-rule cities it doesn't administer).
 *
 * Built by hand from the source named here, by city name to the part's
 * code in the state's rate data; a part code that the rates don't have is
 * reported at ingest (taxability/ingest.ts).
 */
export const SELF_COLLECTED: Record<string, { source: string; title: string; parts: Record<string, string> }> = {
  CO: {
    title: "DR 1002 (12/26/24), Colorado Sales/Use Tax Rates: Home Rule Cities For Which The State Does Not Collect Local Sales Tax (66 cities)",
    // Filed in the archive (Internet Archive capture of 2025-06-05). The
    // publication is now a Looker Studio report (tax.colorado.gov/DR1002,
    // filed 2026-11-03), which can't be archived as a document.
    source: "https://web.archive.org/web/20250605111241id_/https://tax.colorado.gov/sites/tax/files/documents/DR1002_2024_updated.pdf",
    parts: {
    "01:ttr241": "Arvada",
    "01:ttr292": "Aurora",
    "01:ttr255": "Avon",
    "01:ttr331": "Black Hawk",
    "01:ttr209": "Boulder",
    "01:ttr116": "Breckenridge",
    "01:ttr220": "Brighton",
    "01:ttr22": "Broomfield, City and County",
    "01:ttr288": "Castle Pines",
    "01:ttr174": "Castle Rock",
    "01:ttr271": "Centennial",
    "01:ttr213": "Central City",
    "01:ttr264": "Cherry Hills Village",
    "01:ttr128": "Colorado Springs",
    "01:ttr293": "Commerce City",
    "01:ttr83": "Cortez",
    "01:ttr98": "Craig",
    "01:ttr90": "Crested Butte",
    "01:ttr101": "Dacono",
    "01:ttr133": "Delta",
    "01:ttr17": "Denver, City and County",
    "01:ttr327": "Durango",
    "01:ttr315": "Englewood",
    "01:ttr304": "Evans",
    "01:ttr294": "Federal Heights",
    "01:ttr93": "Fort Collins",
    "01:ttr79": "Frisco",
    "01:ttr269": "Glendale",
    "01:ttr227": "Glenwood Springs",
    "01:ttr319": "Golden",
    "01:ttr249": "Grand Junction",
    "01:ttr225": "Greeley",
    "01:ttr316": "Greenwood Village",
    "01:ttr280": "Gunnison",
    "01:ttr334": "Gypsum",
    "01:ttr325": "Lafayette",
    "01:ttr171248": "Lakewood",
    "01:ttr285": "Lamar",
    "01:ttr321": "Littleton",
    "01:ttr173": "Lone Tree",
    "01:ttr107": "Longmont",
    "01:ttr198": "Louisville",
    "01:ttr278": "Loveland",
    "01:ttr146": "Montrose",
    "01:ttr139": "Monument",
    "01:ttr282": "Mount Crested Butte",
    "01:ttr254": "Mountain Village",
    "01:ttr231": "Northglenn",
    "01:ttr122": "Parker",
    "01:ttr310": "Pueblo",
    "01:ttr190": "Ridgway",
    "01:ttr247": "Rifle",
    "01:ttr270": "Sheridan",
    "01:ttr234": "Silverthorne",
    "01:ttr125": "Snowmass Village",
    "01:ttr113": "Steamboat Springs",
    "01:ttr137": "Sterling",
    "01:ttr252": "Telluride",
    "01:ttr238": "Thornton",
    "01:ttr279": "Timnath",
    "01:ttr307": "Vail",
    "01:ttr295": "Westminster",
    "01:ttr320": "Wheat Ridge",
    "01:ttr102": "Windsor",
    "01:ttr89": "Winter Park",
    "01:ttr140": "Woodland Park",
    },
  },
};

/** `code` is a self-collected local part in `state`. */
export const selfCollected = (state: string, code: string) => Object.hasOwn(SELF_COLLECTED[state]?.parts ?? {}, code);
