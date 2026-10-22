import { afterEach, describe, expect, it, vi } from "vitest";
const { locator, regional } = vi.hoisted(() => ({ locator: vi.fn(), regional: vi.fn() }));
vi.mock("../src/geocoding/index.js", () => ({ createLocator: () => locator }));
vi.mock("../src/regions.js", () => ({ regionsAt: regional }));
import { addressRates, type AddressRate } from "../src/rates/index.js";
import { lookUpRate } from "../src/lookup.js";

const point = { lon: -122.35, lat: 47.62, accuracy: "rooftop" as const };
const query = { state: "wa", street: "400 Broad St", city: "Seattle", date: "2026-10-22" };
const rate = { state: "WA", rate: 0.1055, stateRate: 0.065, localRate: 0.0405, parts: [], match: "street", locationIds: {} } as unknown as AddressRate;
afterEach(() => { vi.restoreAllMocks(); locator.mockReset(); regional.mockReset(); });

describe("regional lookup integration", () => {
  it("leaves unexpanded answers and street lookups unchanged", async () => {
    vi.spyOn(addressRates, "at").mockResolvedValue(rate);
    expect(await lookUpRate(query)).toBe(rate);
    expect(locator).not.toHaveBeenCalled();
    expect(regional).not.toHaveBeenCalled();
  });
  it("reuses the final refined point without invoking another geocode", async () => {
    locator.mockResolvedValueOnce({ ...point, accuracy: "interpolated" }).mockResolvedValueOnce(point);
    vi.spyOn(addressRates, "at").mockImplementation(async q => {
      await q.locate!();
      await q.locate!({ marginUnder: 30 });
      return rate;
    });
    regional.mockImplementation(async (state, date, locate) => {
      expect(state).toBe("WA");
      expect(date).toBe(query.date);
      expect(await locate()).toEqual(point);
      return { matches: [], coverage: [] };
    });
    const answer = await lookUpRate(query, { regions: true });
    expect(locator).toHaveBeenCalledTimes(2);
    expect(answer).toEqual({ ...rate, regions: { matches: [], coverage: [] } });
    expect(rate).not.toHaveProperty("regions");
  });
  it("lets the regional evaluator request placement after a street-only tax match", async () => {
    vi.spyOn(addressRates, "at").mockResolvedValue(rate);
    locator.mockResolvedValue(point);
    regional.mockImplementation(async (_state, _date, locate) => {
      expect(await locate()).toEqual(point);
      return { matches: [], coverage: [] };
    });
    expect((await lookUpRate(query, { regions: true })).rate).toBe(rate.rate);
    expect(locator).toHaveBeenCalledTimes(1);
  });
});
