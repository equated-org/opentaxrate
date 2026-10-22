/**
 * New Mexico's gross receipts tax, from the Taxation and Revenue
 * Department's published location layer: every polygon is one reporting
 * location (a city, a county's remainder outside its cities, a tax increment
 * district, a pueblo) carrying its whole combined rate, state's 4.875%
 * included. Each is an exclusive area, so the location an address falls in
 * gives its rate; on tribal land the rate is the one for sales between
 * non-members.
 *
 * Rates come from this period's layer (July to June) and the last one's;
 * outlines from this period's.
 *
 * Each location keeps the layer's name, and its locat_cdr, locat_cd1 and
 * locat_cd2 codes where they aren't blank, from the newest period.
 */
import type { GeoRateRow, GeoState, GeoStateData, JurisdictionRow } from "./index.js";
import { bboxOf, fetchLayer } from "./sources.js";

const SERVICES = "https://services5.arcgis.com/f4lpEvI6fkgVYigk/arcgis/rest/services";
const STATE = 0.04875;

export const newMexico: GeoState = {
  state: "NM",
  async fetch() {
    const now = new Date();
    const july = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    const periods = [july, july - 1].map((year) => ({
      from: `${year}-07-01`,
      to: `${year + 1}-06-30`,
      service: `New_Mexico_gross_receipts_tax_July_${year}_June_${year + 1}_pub_WM`,
    }));
    const rates: GeoRateRow[] = [
      { type: "45", code: "35", rate: STATE, startsOn: periods[1].from, endsOn: periods[0].to },
      { type: "need", code: "x", rate: 0, startsOn: periods[1].from, endsOn: periods[0].to },
    ];
    let shapes: GeoStateData["shapes"] = [];
    const jurisdictions = new Map<string, JurisdictionRow>();
    for (const [i, period] of periods.entries()) {
      const features = await fetchLayer(await polygonLayer(period.service));
      const seen = new Set<string>();
      for (const f of features) {
        const a = f.attributes;
        // Unused code fields hold a space, not nothing: on tribal land the
        // remainder code is " " and the two tribal codes follow.
        const code = [a.locat_cdr, a.locat_cd2, a.locat_cd1].map((c) => String(c ?? "").trim()).find(Boolean) ?? "";
        const rate = Number(a.grt_rate) || Number(a.grt_rate2);
        if (!/^\d{2}-\d{3}$/.test(code) || !rate) continue;
        if (i === 0)
          shapes.push({ kind: "district", fips: code, name: String(a.name).replace(/[*^]+$/, "").trim(), rings: f.rings, bbox: bboxOf(f.rings) });
        if (seen.has(code)) continue;
        seen.add(code);
        if (!jurisdictions.has(code)) {
          const ids: Record<string, string> = {};
          for (const field of ["locat_cdr", "locat_cd1", "locat_cd2"]) {
            const value = String(a[field] ?? "").trim();
            if (value) ids[field] = value;
          }
          jurisdictions.set(code, { type: "x", code, name: String(a.name ?? "").trim() || null, ids });
        }
        rates.push({
          type: "x",
          code,
          rate: Math.round((rate / 100 - STATE) * 1e6) / 1e6,
          startsOn: period.from,
          endsOn: period.to,
        });
      }
      if (i === 0 && !shapes.length) throw new Error(`NM layer ${period.service} has no locations`);
    }
    shapes = shapes.filter((s) => s.rings.length);
    return {
      rates,
      jurisdictions: [...jurisdictions.values()],
      shapes,
      files: { rates: `NM ${periods[1].service} + ${periods[0].service}`, boundaries: `NM ${periods[0].service}` },
    };
  },
};

/** The service's polygon layer, whatever its id. */
async function polygonLayer(service: string) {
  const url = `${SERVICES}/${service}/FeatureServer`;
  const response = await fetch(`${url}?f=json`);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const body = (await response.json()) as { layers?: Array<{ id: number; geometryType?: string }> };
  const layer = body.layers?.find((l) => l.geometryType === "esriGeometryPolygon") ?? body.layers?.[0];
  if (!layer) throw new Error(`${url} has no layers`);
  return `${url}/${layer.id}`;
}
