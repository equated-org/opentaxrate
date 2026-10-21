/**
 * South Carolina: 6% state plus each county's local taxes (local option,
 * capital projects, school district, transportation, education capital
 * improvement), all countywide, and Myrtle Beach's 1% tourism development
 * tax inside its city limits. From the Department of Revenue's ST-500,
 * effective 2026-05-01, which is where coverage starts.
 *
 * Myrtle Beach's limits are the Revenue and Fiscal Affairs Office's
 * municipal outline, the one SCDOR's address lookup reads, which RFA keeps
 * up with annexations; the Census's lags it.
 *
 * Sales on the Catawba Indian Reservation and taxes counties or cities
 * collect themselves aren't in it.
 */
import type { GeoState } from "./index.js";
import { bboxOf, fetchLayer } from "./sources.js";
import { stateTable, type LocalRate } from "./tables.js";

const FROM = "2026-05-01";
const MUNICIPALITIES = "https://gis.state.sc.us/arcgis/rest/services/Boundaries_Districts/Municipalities/FeatureServer/0";
/** Myrtle Beach's tourism development tax, keyed to RFA's outline. */
const MYRTLE_BEACH = { type: "td", code: "MB", name: "MYRTLE BEACH", rate: 0.01 };

/** County totals, state's 6% included. */
const COUNTIES: Record<string, number> = {
  Abbeville: 7, Aiken: 8, Allendale: 8, Anderson: 7, Bamberg: 8, Barnwell: 8,
  Beaufort: 6, Berkeley: 9, Calhoun: 8, Charleston: 9, Cherokee: 8,
  Chester: 8, Chesterfield: 8, Clarendon: 7, Colleton: 8, Darlington: 8,
  Dillon: 8, Dorchester: 7, Edgefield: 8, Fairfield: 7, Florence: 8,
  Georgetown: 7, Greenville: 6, Greenwood: 7, Hampton: 7, Horry: 8,
  Jasper: 9, Kershaw: 8, Lancaster: 8, Laurens: 8, Lee: 8, Lexington: 7,
  McCormick: 8, Marion: 8, Marlboro: 8, Newberry: 7, Oconee: 6,
  Orangeburg: 7, Pickens: 7, Richland: 8, Saluda: 8, Spartanburg: 7,
  Sumter: 8, Union: 7, Williamsburg: 8, York: 7,
};

const counties = stateTable("SC", () => ({
  stateRates: [{ rate: 0.06, from: FROM }],
  locals: [
    ...Object.entries(COUNTIES).map(
      ([name, total]): LocalRate => ({
        name,
        rate: Math.round((total / 100 - 0.06) * 1e6) / 1e6,
        from: FROM,
        type: "00",
      }),
    ),
  ],
  source: "SC DOR ST-500 (effective 2026-05-01)",
}));

export const southCarolina: GeoState = {
  state: "SC",
  async fetch(dir) {
    const data = await counties.fetch(dir);
    const outline = await fetchLayer(MUNICIPALITIES, { where: `CITY_NAME = '${MYRTLE_BEACH.name}'` });
    if (!outline.length) throw new Error("SC RFA has no Myrtle Beach outline");
    data.rates.push({ type: MYRTLE_BEACH.type, code: MYRTLE_BEACH.code, rate: MYRTLE_BEACH.rate, startsOn: FROM, endsOn: "9999-12-31" });
    data.shapes = outline.map((f) => ({ kind: "district" as const, fips: MYRTLE_BEACH.code, name: "Myrtle Beach", rings: f.rings, bbox: bboxOf(f.rings) }));
    data.files.boundaries = "SC RFA municipal limits (Myrtle Beach)";
    return data;
  },
};
