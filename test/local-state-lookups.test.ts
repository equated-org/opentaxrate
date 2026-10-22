import { afterEach, describe, expect, it, vi } from "vitest";
import { RateError } from "../src/errors.js";
import { addressRates } from "../src/rates/index.js";
import { sstRateAt } from "../src/rates/ranges.js";
import { stateLookupAt } from "../src/rates/state-lookups.js";
vi.mock("../src/rates/ranges.js", () => ({ sstRateAt: vi.fn() }));
vi.mock("../src/rates/names.js", () => ({ describeParts: async (_state: string, parts: unknown) => parts }));
vi.mock("../src/rates/state-lookups.js", async (original) => ({ ...await original<typeof import("../src/rates/state-lookups.js")>(), stateLookupAt: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const query = { state: "MO", street: "5007 Chariton Drive", city: "Columbia", zip: "65202",
  locate: async () => ({ lon: -92.260421, lat: 38.973541, accuracy: "rooftop" as const }) };
describe("Missouri's optional live lookup", () => {
  it("makes no live state request when indexed data settles the address", async () => {
    vi.stubEnv("STATE_LOOKUPS", "MO");
    vi.mocked(sstRateAt).mockResolvedValue({ rate: .07975, byType: { general: .07975, generalInterstate: null, foodDrug: null, foodDrugInterstate: null },
      parts: [{ kind: "state", code: "45:29", rate: .04225 }, { kind: "district", code: "99:15670-019-000", rate: .0375 }],
      match: "map", locationCode: "15670-019-000", locationIds: { "Jurisdiction Code": "15670-019-000" }, files: ["MO workbook", "MO tax polygons (MSDIS archive 2023-05-11)"] });
    expect(await addressRates.at(query, "2026-10-21")).toMatchObject({ rate: .07975, match: "map" });
    expect(stateLookupAt).not.toHaveBeenCalled();
  });
  it("tries the enabled official lookup when local evidence is insufficient", async () => {
    vi.stubEnv("STATE_LOOKUPS", "MO");
    vi.mocked(sstRateAt).mockRejectedValue(new RateError("More evidence needed", 422));
    vi.mocked(stateLookupAt).mockRejectedValue(new Error("official lookup invoked"));
    await expect(addressRates.at(query, "2026-10-21")).rejects.toThrow("official lookup invoked");
    expect(stateLookupAt).toHaveBeenCalledOnce();
  });
  it("does not hide unexpected local failures behind an outside request", async () => {
    vi.stubEnv("STATE_LOOKUPS", "MO");
    vi.mocked(sstRateAt).mockRejectedValue(new Error("database failure"));
    await expect(addressRates.at(query, "2026-10-21")).rejects.toThrow("database failure");
    expect(stateLookupAt).not.toHaveBeenCalled();
  });
});
