/**
 * Montana has no state sales tax, but its resort areas levy a resort tax on
 * most retail sales. Everything here is read at refresh, nothing is listed in
 * code:
 *   - the resort areas, their rates and the year each was enacted, from the
 *     Department of Revenue's table
 *     (https://revenuefiles.mt.gov/taxes/miscellaneous/local-resort-tax);
 *   - their outlines, from the Montana State Library's Administrative
 *     Boundaries Framework: an area that is an incorporated town takes the
 *     town's outline (layer 7); any other takes the resort districts named
 *     for it (layer 51). An area with neither keeps no outline.
 *
 * Each area's rate is the table's, stored as a resort-tax row ("rt") under
 * the area's outline, so the map engine answers inside it and refuses only
 * near its edge. The Department says it doesn't administer the tax and its
 * table may be out of date, and the source on every answer names the table:
 * West Yellowstone's own page says 4% since a 2019 vote where the table says
 * 3%. An area with no outline (Craig, Wolf Creek) is stored as "no" and
 * refused by name (see rates/index.ts).
 */
import type { GeoRateRow, GeoState, GeoStateData } from "./index.js";
import { bboxOf, fetchLayer, fetchText } from "./sources.js";
import { districtCode } from "../../coverage.js";

const DOR = "https://revenuefiles.mt.gov/taxes/miscellaneous/local-resort-tax";
const FRAMEWORK =
  "https://services.arcgis.com/qnjIrwR8z5Izc0ij/arcgis/rest/services/Montana_Administrative_Boundaries_Framework/FeatureServer";
const UNTIL = "9999-12-31";

/** Upper case, punctuation dropped, "Saint" as "St". */
const plain = (s: string) =>
  s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\bSAINT\b/g, "ST").replace(/\s+/g, " ").trim();

export const montana: GeoState = {
  state: "MT",
  async fetch(dir) {
    const areas = resortAreas(await fetchText(DOR, dir, "mt-local-resort-tax.html"));
    if (!areas.length) throw new Error(`No resort areas read from ${DOR}`);
    const towns = await fetchLayer(`${FRAMEWORK}/7`);
    const districts = await fetchLayer(`${FRAMEWORK}/51`);
    const shapes: GeoStateData["shapes"] = [];
    for (const area of areas) {
      const name = plain(area.name);
      const town = towns.filter((f) => plain(String(f.attributes.NAME ?? "")) === name);
      // A district is the area's when it is a resort district whose name
      // holds the area's name ("BIG SKY RESORT", "RESORT DIST - BIG SKY").
      const own = town.length ? town : districts.filter((f) => {
        const district = ` ${plain(String(f.attributes.DistrictName ?? ""))} `;
        return district.includes(" RESORT") && district.includes(` ${name} `);
      });
      for (const f of own)
        if (f.rings.length)
          shapes.push({ kind: "district", fips: districtCode(area.name), name: area.name, rings: f.rings, bbox: bboxOf(f.rings) });
    }
    const outlined = new Set(shapes.map((s) => s.fips));
    const rates: GeoRateRow[] = [
      { type: "45", code: "30", rate: 0, startsOn: "2000-01-01", endsOn: UNTIL },
      ...areas.map((a) => ({
        type: outlined.has(districtCode(a.name)) ? "rt" : "no",
        code: districtCode(a.name),
        rate: a.rate,
        startsOn: `${a.since}-01-01`,
        endsOn: UNTIL,
      })),
    ];
    return { rates, shapes, files: { rates: "MT DOR local resort tax table", boundaries: "MT Administrative Boundaries Framework layers 7, 51" } };
  },
};

/** The Department's table: one row per area, its rate and the year enacted. */
function resortAreas(html: string) {
  const cells = (row: string) =>
    [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((m) => {
    const [name, rate, year] = cells(m[1]);
    const percent = /^([\d.]+)\s*%$/.exec(rate ?? "")?.[1];
    return name && percent && /^\d{4}$/.test(year ?? "") ? [{ name, rate: Number(percent) / 100, since: year }] : [];
  });
}
