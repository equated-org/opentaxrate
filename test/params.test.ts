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
    const tuned = await load('{"wideMetres":10000,"minMarginMetres":{"rooftop":10}}');
    expect(tuned.wideMetres).toBe(10_000);
    expect(tuned.minMarginMetres).toEqual({ rooftop: 10, parcel: 25, point: 40, interpolated: 75 });
    // An override changes this run only, never the defaults.
    expect((await load()).minMarginMetres.rooftop).toBe(15);
  });

  it("leave Google and HERE out by default: Mapbox stands in for both", async () => {
    expect((await load()).disabledGeocoders).toEqual(["google", "here"]);
  });

  it("refuse a setting that doesn't exist", async () => {
    await expect(load('{"wideMeters":20000}')).rejects.toThrow(/unknown settings: wideMeters/);
  });

  it("refuse a value of the wrong kind rather than run on a guess", async () => {
    await expect(load('{"lonePointOutsideCity":"false"}')).rejects.toThrow(/lonePointOutsideCity must be a boolean/);
    await expect(load('{"wideMetres":-1}')).rejects.toThrow(/wideMetres must be a number of 0 or more/);
    await expect(load('{"disabledGeocoders":"google"}')).rejects.toThrow(/disabledGeocoders must be a list/);
    await expect(load('{"minMarginMetres":{"roof":10}}')).rejects.toThrow(/minMarginMetres has no roof/);
    await expect(load('{"minMarginMetres":{"rooftop":"10"}}')).rejects.toThrow(/minMarginMetres.rooftop must be a number/);
    await expect(load("{wideMetres:1}")).rejects.toThrow(/OTR_PARAMS isn't valid JSON/);
  });
});

describe("agreement between geocodes", () => {
  const at = (provider: string, source: string, lon: number) =>
    ({ provider, source, lon, lat: 44.2887, accuracy: "rooftop" as const });
  // Three rooftops ~95 m apart, as Weiser's were.
  const points = [at("esri", "esri", -116.85176), at("here", "here", -116.85053), at("google", "google", -116.85295)];

  it("finds none at the margins alone, and a group when agreeFactor allows", async () => {
    await load();
    const { agreeingGroup } = await import("../src/geocoding/agreement.js");
    expect(agreeingGroup(points)).toBeNull();
    await load('{"agreeFactor":8}');
    const looser = await import("../src/geocoding/agreement.js");
    expect(looser.agreeingGroup(points)?.length).toBeGreaterThanOrEqual(2);
  });
});
