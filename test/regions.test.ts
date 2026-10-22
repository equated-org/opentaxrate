import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { taxSourceSnapshots } from "../src/db/schema.js";
import { loadEvidence } from "../src/ingest/supplemental.js";
import { REGION_SOURCES, regionMatch, regionSource, regionsAt } from "../src/regions.js";
import { SUPPLEMENTAL_POLYGONS } from "../src/ingest/supplemental-sources.js";

const now = new Date("2026-10-22T12:00:00Z");
const point = { lon: -122.5, lat: 47.5, accuracy: "rooftop" as const };
const rings: Array<Array<[number, number]>> = [[[-123, 47], [-122, 47], [-122, 48], [-123, 48], [-123, 47]]];
const snapshots: string[] = [];
async function fixture(id: string, metadata: Record<string, unknown>, attributes: Record<string, unknown>, count = 1) {
  const result = await loadEvidence({ id, state: id.slice(0, 2).toUpperCase(), url: "https://example.test/regions" },
    Array.from({ length: count }, (_, i) => ({ id: String(i + 1), attributes, rings })), metadata);
  snapshots.push(result.id);
  return result;
}
beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test")) throw new Error("Regional fixtures require a *_test database");
  await fixture("wa-rta", { quarter: "2026Q3" }, { RTA_NAME: "Previous district" });
  await fixture("wa-rta", { quarter: "2026Q4" }, { RTA_NAME: "Transit district", GlobalID: "publisher-id", RATE: 0.01 }, 2);
  await fixture("wa-ptba", { quarter: "2026Q4", recordsWithoutGeometry: [{ id: "3", attributes: { PTBA_NAME: "Unmapped" } }] }, { PTBA_NAME: "Benefit area", PTBA_LOC: "0012" });
  await fixture("ut-transit", {}, { SHORTDESC: "Transit", TAXDIST: 991022 });
  await fixture("tn-cbid-2026", {}, { Name: "2026 district" });
  await fixture("tn-cbid-2027", {}, { Name: "2027 district" });
});
afterAll(async () => {
  if (snapshots.length) await db.delete(taxSourceSnapshots).where(inArray(taxSourceSnapshots.id, snapshots));
  await client.end();
});

describe("supplemental regional membership", () => {
  it("registers every ingested supplemental polygon family", () => {
    expect(REGION_SOURCES.map(s => s.id)).toEqual(expect.arrayContaining(SUPPLEMENTAL_POLYGONS.map(s => s.id)));
    expect(new Set(REGION_SOURCES.map(s => s.id)).size).toBe(REGION_SOURCES.length);
  });
  it("keeps overlapping features and publisher attributes, selecting the requested quarter", async () => {
    const result = await regionsAt("wa", "2026-10-22", async () => point, now);
    const matches = result.matches.filter(m => m.source.id === "wa-rta");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({ kind: "transit", type: "regional_transit_authority", name: "Transit district",
      ids: { GlobalID: "publisher-id" }, attributes: { RATE: 0.01 }, source: { edition: "2026Q4", startsOn: "2026-10-01", endsOn: "2026-12-31", dateBasis: "published_edition" } });
    expect(result.coverage.find(c => c.source === "wa-rta")?.status).toBe("evaluated");
    expect(result.coverage.find(c => c.source === "wa-cities")?.status).toBe("unavailable");
    expect(result.coverage.find(c => c.source === "wa-ptba")?.status).toBe("incomplete");
    expect(result.matches.find(m => m.source.id === "wa-ptba")?.ids).toEqual({ PTBA_LOC: "0012" });
    const previous = await regionsAt("WA", "2026-09-30", async () => point, now);
    expect(previous.matches.map(m => m.name)).toEqual(["Previous district"]);
  });

  it("does not geocode dates with no coverage or states without sources", async () => {
    const locate = vi.fn(async () => point);
    const result = await regionsAt("WA", "2027-01-01", locate, now);
    expect(result.matches).toEqual([]);
    expect(result.coverage.find(c => c.source === "wa-rta")?.status).toBe("date_uncovered");
    expect(await regionsAt("CT", "2026-10-22", locate, now)).toEqual({ matches: [], coverage: [] });
    expect(locate).not.toHaveBeenCalled();
  });

  it("distinguishes outside from an uncertain point on either side of a boundary", async () => {
    const outside = await regionsAt("WA", "2026-10-22", async () => ({ ...point, lon: -121 }), now);
    expect(outside.matches).toEqual([]);
    expect(outside.coverage.find(c => c.source === "wa-rta")?.status).toBe("evaluated");
    for (const lon of [-122, -122.00001, -121.99999]) {
      const edge = await regionsAt("WA", "2026-10-22", async () => ({ ...point, lon }), now);
      expect(edge.matches).toEqual([]);
      expect(edge.coverage.find(c => c.source === "wa-rta")?.status).toBe("location_uncertain");
    }
  });

  it("reports unavailable placement without making outside claims, and locates once", async () => {
    const locate = vi.fn(async () => { throw new Error("provider unavailable"); });
    const result = await regionsAt("WA", "2026-10-22", locate, now);
    expect(result.matches).toEqual([]);
    expect(result.coverage.find(c => c.source === "wa-rta")?.status).toBe("location_uncertain");
    expect(locate).toHaveBeenCalledTimes(1);
  });

  it("exposes undated data as latest evidence for today, never as historical coverage", async () => {
    const result = await regionsAt("UT", "2026-10-22", async () => point, now);
    expect(result.matches[0]).toMatchObject({ name: "Transit", ids: { TAXDIST: "991022" },
      source: { edition: null, startsOn: null, endsOn: null, dateBasis: "latest_snapshot" } });
    const locate = vi.fn(async () => point);
    expect((await regionsAt("UT", "2026-10-21", locate, now)).coverage[0].status).toBe("date_uncovered");
    expect(locate).not.toHaveBeenCalled();
  });

  it("keeps future Tennessee boundaries separate", async () => {
    expect((await regionsAt("TN", "2026-10-22", async () => point, now)).matches.map(m => m.name)).toEqual(["2026 district"]);
    expect((await regionsAt("TN", "2027-01-01", async () => point, now)).matches.map(m => m.name)).toEqual(["2027 district"]);
  });

  it("normalizes Good Life districts without changing raw units or inventing names", () => {
    const d = REGION_SOURCES.find(d => d.id === "ne-tax-areas")!;
    const source = {} as ReturnType<typeof regionSource>;
    expect(regionMatch(d, source, "1", { GLDCode: "001", NAME: "District", TotalRate: 5.5 })).toMatchObject({
      kind: "special_district", type: "good_life_district", ids: { GLDCode: "001" }, attributes: { TotalRate: 5.5 } });
    expect(regionMatch(d, source, "1", { GLDCode: "N/A" }).kind).toBe("tax_area");
    expect(regionMatch(d, source, "1", {}).name).toBeNull();
  });
});
