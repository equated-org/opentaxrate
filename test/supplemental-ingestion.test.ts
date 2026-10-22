import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { client, db } from "../src/db/client.js";
import { taxRuleRows, taxSourceFeatures, taxSourceSnapshots } from "../src/db/schema.js";
import { fetchEvidenceLayer, loadEvidence, washingtonSources } from "../src/ingest/supplemental.js";

const source = { id: "test-supplemental", state: "CA", url: "https://example.test/FeatureServer/0", role: "tax-area" as const, note: "fixture" };
const rings: Array<Array<[number, number]>> = [[[-120, 38], [-119, 38], [-119, 39], [-120, 39], [-120, 38]]];
let dir: string;
beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith("_test")) throw new Error("Supplemental fixtures require a *_test database");
  dir = await mkdtemp(path.join(tmpdir(), "tax-evidence-"));
});
afterAll(async () => {
  await db.delete(taxSourceSnapshots).where(eq(taxSourceSnapshots.source, source.id));
  await rm(dir, { recursive: true, force: true });
  await client.end();
});

describe("versioned evidence", () => {
  it("rejects experimental policy snapshots while polygon evidence remains enabled", async () => {
    const base = { state: "TX", url: "https://example.test/policy", sha256: "unused", rows: 1 };
    await expect(db.insert(taxSourceSnapshots).values({ ...base, id: "blocked-sst-policy",
      source: "sst-tx-definitions", metadata: {} })).rejects.toThrow();
    await expect(db.insert(taxSourceSnapshots).values({ ...base, id: "blocked-cap-policy",
      source: "tx-cap", metadata: { status: "needs-normalization" } })).rejects.toThrow();
    expect(await db.select().from(taxSourceSnapshots).where(eq(taxSourceSnapshots.id, "blocked-sst-policy"))).toHaveLength(0);
    expect(await db.select().from(taxSourceSnapshots).where(eq(taxSourceSnapshots.id, "blocked-cap-policy"))).toHaveLength(0);
  });

  it("preserves previous editions, deduplicates repeats and retains source attributes", async () => {
    const first = await loadEvidence(source, [{ id: "1", attributes: { TAC_txt: "001", RATE: .09 }, rings }], { quarter: "2026Q3" });
    const repeat = await loadEvidence(source, [{ id: "1", attributes: { TAC_txt: "001", RATE: .09 }, rings }], { quarter: "2026Q3" });
    const next = await loadEvidence(source, [{ id: "1", attributes: { TAC_txt: "001", RATE: .095 }, rings }], { quarter: "2026Q4" });
    expect(first.id).toBe(repeat.id);
    expect(first.id).not.toBe(next.id);
    const snapshots = await db.select().from(taxSourceSnapshots).where(eq(taxSourceSnapshots.source, source.id));
    expect(snapshots).toHaveLength(2);
    expect((await db.select().from(taxSourceFeatures).where(eq(taxSourceFeatures.snapshotId, first.id)))[0].attributes.RATE).toBe(.09);
    expect(await db.select().from(taxRuleRows).where(eq(taxRuleRows.snapshotId, first.id))).toHaveLength(0);
    await expect(loadEvidence(source, [{ id: "2", attributes: {}, rings: [] }], {})).rejects.toThrow("invalid WGS84");
    // Syntactically plausible coordinates can still produce an empty or
    // invalid polygon. A database failure must roll back the manifest too.
    await expect(loadEvidence(source, [{ id: "3", attributes: {}, rings: [[[-120, 38], [-120, 38], [-120, 38], [-120, 38]]] }], {})).rejects.toThrow();
    expect(await db.select().from(taxSourceSnapshots).where(eq(taxSourceSnapshots.source, source.id))).toHaveLength(2);
  });

  it("rejects truncated and substituted ArcGIS features before loading", async () => {
    const { digest } = await import("../src/ingest/supplemental.js");
    await writeFile(path.join(dir, `${source.id}-metadata.json`), JSON.stringify({ geometryType: "esriGeometryPolygon" }));
    await writeFile(path.join(dir, `${source.id}-ids-${digest("1=1").slice(0, 12)}.json`), JSON.stringify({ objectIdFieldName: "OID", objectIds: [1, 2] }));
    await writeFile(path.join(dir, `${source.id}-features-0.json`), JSON.stringify({ features: [{ attributes: { OID: 1 }, geometry: { rings } }] }));
    await expect(fetchEvidenceLayer(source, dir)).rejects.toThrow("incomplete polygon batch");
    await writeFile(path.join(dir, `${source.id}-features-0.json`), JSON.stringify({ features: [1, 3].map((OID) => ({ attributes: { OID }, geometry: { rings } })) }));
    await expect(fetchEvidenceLayer(source, dir)).rejects.toThrow("unexpected polygon ID 3");
  });

  it("discovers dated WA releases per family instead of assuming the live map quarter", async () => {
    const links = ["LOCCODE_PUBLIC", "Cities", "PTBA", "RTA"].flatMap((family) => ["26Q3", "26Q4"].map((q) =>
      `<a href="/sites/default/files/2026-08/${family}_${q}.zip">download</a>`)).join("\n");
    await writeFile(path.join(dir, "wa-sales-tax-boundaries.html"), links);
    const sources = await washingtonSources(dir);
    expect(sources).toHaveLength(4);
    expect(sources.every((s) => s.quarter === "26Q4")).toBe(true);
  });

  it("retains an allowed geometry-less record as an explicit acquisition gap", async () => {
    const { digest } = await import("../src/ingest/supplemental.js");
    await writeFile(path.join(dir, `${source.id}-metadata.json`), JSON.stringify({ geometryType: "esriGeometryPolygon" }));
    await writeFile(path.join(dir, `${source.id}-ids-${digest("1=1").slice(0, 12)}.json`), JSON.stringify({ objectIdFieldName: "OID", objectIds: [1, 2] }));
    await writeFile(path.join(dir, `${source.id}-features-0.json`), JSON.stringify({ features: [
      { attributes: { OID: 1 }, geometry: { rings } }, { attributes: { OID: 2, name: "Unmapped city" } },
    ] }));
    await expect(fetchEvidenceLayer(source, dir)).rejects.toThrow("invalid WGS84");
    const result = await fetchEvidenceLayer({ ...source, allowMissingGeometry: true }, dir);
    expect(result.features).toHaveLength(1);
    expect(result.metadata.sourceRecords).toBe(2);
    expect(result.metadata.recordsWithoutGeometry).toEqual([{ id: "2", attributes: { OID: 2, name: "Unmapped city" } }]);
  });
});
