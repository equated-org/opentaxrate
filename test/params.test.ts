import { afterEach, describe, expect, it, vi } from "vitest";

const load = async (raw?: string) => {
  vi.resetModules();
  if (raw === undefined) delete process.env.OTR_PARAMS;
  else process.env.OTR_PARAMS = raw;
  return (await import("../src/params.js")).PARAMS;
};

afterEach(() => {
  delete process.env.OTR_PARAMS;
  vi.resetModules();
});

describe("tunable settings", () => {
  it("run with the defaults unless OTR_PARAMS overrides some", async () => {
    expect((await load()).wideMetres).toBe(20_000);
    const tuned = await load('{"wideMetres":10000,"edgeMetres":{"rooftop":10}}');
    expect(tuned.wideMetres).toBe(10_000);
    expect(tuned.edgeMetres).toEqual({ rooftop: 10, parcel: 25, point: 40, interpolated: 75 });
  });

  it("refuse a setting that doesn't exist", async () => {
    await expect(load('{"wideMeters":20000}')).rejects.toThrow(/unknown settings: wideMeters/);
  });
});

describe("agreement between geocodes", () => {
  const at = (provider: string, source: string, lon: number) =>
    ({ provider, source, lon, lat: 44.2887, accuracy: "rooftop" as const });
  // Three rooftops ~95 m apart, as Weiser's were.
  const points = [at("esri", "esri", -116.85176), at("here", "here", -116.85053), at("google", "google", -116.85295)];

  it("finds none at the margins alone, and a group when the fallback factor allows", async () => {
    await load();
    const { agreeingGroup } = await import("../src/geocoding/agreement.js");
    expect(agreeingGroup(points)).toBeNull();
    await load('{"agreeFallbackFactor":8}');
    const fallback = await import("../src/geocoding/agreement.js");
    expect(fallback.agreeingGroup(points)?.length).toBeGreaterThanOrEqual(2);
  });
});
