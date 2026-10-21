/**
 * Asking Jev to pick a street: any failure is no answer, so a lookup never
 * fails because Jev did, and Jev can only pick a street it was offered.
 *
 * Setup: no network; fetch is stubbed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { jevChoice } from "../src/rates/streets/jev.js";

const reply = (pick: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify({ answers: { pick } }), { status }));
const ask = () => jevChoice("200 N Hihg St", "Which street?", ["N HIGH ST", "S HIGH ST"], "None.");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a street picked by Jev", () => {
  it("is the offered street it chose, with its confidence", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const fetch = reply({ type: "choice", choice: "N HIGH ST", confidence: 0.76 });
    vi.stubGlobal("fetch", fetch);
    expect(await ask()).toEqual({ choice: "N HIGH ST", confidence: 0.76 });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(Object.keys(body.questions.pick.criteria)).toEqual(["N HIGH ST", "S HIGH ST", "NONE"]);
  });

  it("is never asked without a key", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const fetch = reply({ choice: "N HIGH ST", confidence: 1 });
    vi.stubGlobal("fetch", fetch);
    expect(await ask()).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["a street it wasn't offered", reply({ choice: "E HIGH ST", confidence: 0.9 })],
    ["an error", reply({}, 500)],
    ["a malformed answer", reply({ choice: 3 })],
    ["a network failure", vi.fn(async () => { throw new Error("down"); })],
  ])("is no answer after %s", async (_, fetch) => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetch);
    expect(await ask()).toBeNull();
  });
});
