import { afterEach, describe, expect, it, vi } from "vitest";
import { marginProbes, stateLookup, stateLookupAt } from "../src/rates/state-lookups.js";

const missouriAnswer = (total: number) =>
  new Response(JSON.stringify({ data: [{ taxCode: { name: "Sales Tax" }, salesTax: { total } }, { taxCode: { name: "Use Tax" }, salesTax: { total: 0.01 } }] }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a state's own lookup", () => {
  it("is used only for the states STATE_LOOKUPS names, or all", () => {
    expect(stateLookup("MO")).toBeNull();
    vi.stubEnv("STATE_LOOKUPS", "co, mo");
    expect(stateLookup("MO")).not.toBeNull();
    expect(stateLookup("AK")).toBeNull();
    vi.stubEnv("STATE_LOOKUPS", "all");
    expect(stateLookup("AK")).not.toBeNull();
    // A state with no lookup of its own isn't turned on by "all".
    expect(stateLookup("WY")).toBeNull();
  });

  it("probes the point alone when it is sure, and the edges of its margin when not", () => {
    expect(marginProbes({ lon: -92, lat: 38, accuracy: "rooftop" })).toHaveLength(5);
    expect(marginProbes({ lon: -92, lat: 38, accuracy: "rooftop" }, 1_000)).toHaveLength(1);
  });

  it("answers only when every probe gives the same Sales Tax total", async () => {
    vi.stubEnv("STATE_LOOKUPS", "MO");
    const missouri = stateLookup("MO")!;
    const point = { lon: -92.1735, lat: 38.5767, accuracy: "rooftop" as const };
    vi.stubGlobal("fetch", vi.fn(async () => missouriAnswer(0.0785)));
    expect(await stateLookupAt(missouri, point, "2026-10-22")).toBe(0.0785);
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => missouriAnswer(call++ ? 0.0785 : 0.0835)));
    expect(await stateLookupAt(missouri, point, "2026-10-22")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    expect(await stateLookupAt(missouri, point, "2026-10-22")).toBeNull();
  });
});
