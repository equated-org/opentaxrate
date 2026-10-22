import { describe, expect, it, vi } from "vitest";
import { parseAddress } from "../src/address-text.js";
import { lookUpRate } from "../src/lookup.js";

vi.mock("../src/lookup.js", async (original) => {
  const actual = await original<typeof import("../src/lookup.js")>();
  return { ...actual, lookUpRate: vi.fn(async () => ({ rate: 0.1 })) };
});

const ok = (text: string) => {
  const r = parseAddress(text);
  if (!r.ok) throw new Error(`${text}: ${r.reason}`);
  return r.address;
};

describe("parseAddress", () => {
  it("reads the format the page writes", () => {
    expect(ok("1100 Congress Ave, Austin, TX 78701")).toEqual({ street: "1100 Congress Ave", city: "Austin", state: "TX", zip: "78701" });
  });
  it("needs no commas", () => {
    expect(ok("1100 Congress Ave Austin TX 78701")).toEqual({ street: "1100 Congress Ave", city: "Austin", state: "TX", zip: "78701" });
    expect(ok("90 W Broad St Columbus OH")).toEqual({ street: "90 W Broad St", city: "Columbus", state: "OH", zip: "" });
  });
  it("keeps a trailing direction with the street", () => {
    expect(ok("1600 Pennsylvania Ave NW Washington DC 20500")).toMatchObject({ street: "1600 Pennsylvania Ave NW", city: "Washington", state: "DC" });
  });
  it("takes a multi-word city without commas", () => {
    expect(ok("500 Main St Salt Lake City UT")).toMatchObject({ street: "500 Main St", city: "Salt Lake City", state: "UT" });
  });
  it("takes full state names, longest first", () => {
    expect(ok("1221 SW 4th Ave, Portland, Oregon 97204")).toMatchObject({ city: "Portland", state: "OR" });
    expect(ok("100 Capitol St, Charleston, West Virginia")).toMatchObject({ city: "Charleston", state: "WV" });
    expect(ok("1 Main St, Albany, new york")).toMatchObject({ city: "Albany", state: "NY" });
  });
  it("takes ZIP+4 and lower-case codes", () => {
    expect(ok("90 W Broad St, Columbus, oh 432151234")).toMatchObject({ state: "OH", zip: "43215-1234" });
    expect(ok("90 W Broad St, Columbus, OH 43215-1234, USA")).toMatchObject({ zip: "43215-1234" });
  });
  it("keeps a unit with the street", () => {
    expect(ok("12 Elm St, Apt 4, Springfield, IL")).toMatchObject({ street: "12 Elm St Apt 4", city: "Springfield" });
    expect(ok("12 Elm St Apt 4 Springfield IL")).toMatchObject({ street: "12 Elm St Apt 4", city: "Springfield" });
  });
  it("guesses the city as the last word when no street type is given", () => {
    expect(ok("742 Evergreen Terrace Springfield IL")).toMatchObject({ street: "742 Evergreen Terrace", city: "Springfield" });
    expect(ok("15 Broadway Fargo ND")).toMatchObject({ street: "15 Broadway", city: "Fargo" });
  });
  it("says what is missing", () => {
    expect(parseAddress("1100 Congress Ave")).toEqual({ ok: false, reason: "state" });
    expect(parseAddress("1100 Congress Ave 78701")).toEqual({ ok: false, reason: "state" });
    expect(parseAddress("Congress Ave, Austin, TX")).toEqual({ ok: false, reason: "number" });
    expect(parseAddress("1100 TX")).toEqual({ ok: false, reason: "state" });
    expect(parseAddress("1100 Congress, TX")).toEqual({ ok: false, reason: "city" });
  });
});

describe("/v1/rate?address=", async () => {
  const { app } = await import("../src/server.js");
  const asked = async (search: string) => {
    vi.mocked(lookUpRate).mockClear();
    const response = await app.request(`/v1/rate?${search}`);
    return { status: response.status, body: await response.json(), query: vi.mocked(lookUpRate).mock.calls[0]?.[0] };
  };

  it("looks up the fields read from the line", async () => {
    const { status, query } = await asked(`address=${encodeURIComponent("1410 E Pine St, Seattle, WA 98122")}&date=2026-10-22`);
    expect(status).toBe(200);
    expect(query).toEqual({ state: "WA", street: "1410 E Pine St", city: "Seattle", zip: "98122", date: "2026-10-22" });
  });

  it("lets the separate fields win", async () => {
    const { query } = await asked(`address=${encodeURIComponent("1410 E Pine St, Seattle, WA")}&zip=98122-1234&city=SEATTLE`);
    expect(query).toMatchObject({ state: "WA", street: "1410 E Pine St", city: "SEATTLE", zip: "98122-1234" });
  });

  it("says what a line is missing", async () => {
    const { status, body } = await asked(`address=${encodeURIComponent("1410 E Pine St")}`);
    expect(status).toBe(400);
    expect(body).toEqual({ error: expect.stringContaining("city and state"), code: "BAD_REQUEST" });
    expect(lookUpRate).not.toHaveBeenCalled();
  });

  it("still needs a state from somewhere", async () => {
    expect((await asked("street=1+Main+St&city=Hartford")).status).toBe(400);
  });
});
