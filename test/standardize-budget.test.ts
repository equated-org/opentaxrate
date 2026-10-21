import { afterEach, describe, expect, it, vi } from "vitest";
import { addressStandardizer } from "../src/standardize/index.js";
import { geocoderProviders } from "../src/geocoding/registry.js";
import { postgresGeocodeBudget as budget } from "../src/geocoding/budget.js";

vi.mock("../src/geocoding/budget.js", () => ({ postgresGeocodeBudget: {
  reserve: vi.fn(), success: vi.fn(), failure: vi.fn(),
} }));
const address = { street: "100 Main St", city: "Austin", state: "TX", zip: "78701" };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("Geocodio standardization shares the geocoding quota", () => {
  it("is off, rather than broken, with a blank key", () => {
    vi.stubEnv("GEOCODIO_API_KEY", "   ");
    expect(addressStandardizer()).toBeUndefined();
  });
  it("does not call the vendor without a reservation", async () => {
    vi.stubEnv("GEOCODIO_API_KEY", "test");
    vi.mocked(budget.reserve).mockResolvedValue(false);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await addressStandardizer()!(address)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reserves the same credential budget and reports a successful no-match", async () => {
    vi.stubEnv("GEOCODIO_API_KEY", "test");
    vi.mocked(budget.reserve).mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [] })));
    expect(await addressStandardizer()!(address)).toBeNull();
    expect(budget.reserve).toHaveBeenCalledWith(expect.objectContaining({
      budgetId: geocoderProviders().find(p => p.id === "geocodio")!.budgetId,
    }));
    expect(budget.success).toHaveBeenCalledTimes(1);
  });
  it("reports HTTP 429 to the shared breaker", async () => {
    vi.stubEnv("GEOCODIO_API_KEY", "test");
    vi.mocked(budget.reserve).mockResolvedValue(true);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    expect(await addressStandardizer()!(address)).toBeNull();
    expect(budget.failure).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: 429 }));
  });
});
