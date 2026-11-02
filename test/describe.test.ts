/**
 * describe=: the picker proposes, the rules decide. The picker here is a
 * stub that answers from a table, so these tests pin what the rules make
 * of a pick: a case settles its tax at the rate its outcome gives, paired
 * taxes settle together, an exception changes a settled tax only when
 * likely enough and reopens it when doubtful, a price never settles an
 * amount case, and any failure answers as without the text.
 *
 * Setup: the reviewed rule files, no database; fetch stubbed for Jev.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ruleSet, taxabilityOf, type Rule } from "../src/taxability/index.js";
import { readRuleFiles } from "../src/taxability/rules/index.js";
import { acceptCode, caseQuestions, asQuestions, describedTaxability, namesCount, needsOf, type Described } from "../src/taxability/describe.js";
import { partsAt } from "../src/taxability/evaluate.js";
import { halfOf } from "../src/taxability/describe-bench.js";
import { cachedPicker, jevPicker, memoryStore, paidPicker, type Picked, type Picker, type Question } from "../src/taxability/picker.js";
import { answerKey } from "../src/cache.js";
import { TaxabilitySchema } from "../src/api-schema.js";
import type { RatePart } from "../src/rates/types.js";

const { rules: rows } = readRuleFiles();
const RULES = ruleSet(rows as Rule[]);
const ct: RatePart[] = [{ kind: "state", name: "Connecticut", code: "CT", rate: 0.0635, ids: {} }];
const DAY = "2026-11-02";

/** Answers each question by the first option whose words match. */
function stub(answers: Array<[RegExp, number]>, code?: Picked): Picker & { asked: Array<Record<string, Question>> } {
  const asked: Array<Record<string, Question>> = [];
  return {
    model: "stub",
    asked,
    async pick(_text, questions) {
      asked.push(questions);
      return Object.fromEntries(
        Object.entries(questions).map(([id, q]) => {
          if (id === "code") return [id, code ?? { choice: "UNCLEAR", confidence: 1, probabilities: { UNCLEAR: 1 } }];
          const probabilities = Object.fromEntries(Object.keys(q.options).map((o) => [o, 0]));
          for (const [pattern, p] of answers) {
            const found = Object.entries(q.options).find(([o, words]) => o !== "NONE" && pattern.test(words) && probabilities[o] === 0);
            if (found) probabilities[found[0]] = p;
          }
          const rest = 1 - Object.values(probabilities).reduce((a, b) => a + b, 0);
          probabilities.NONE = Math.max(0, rest);
          const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0][0];
          return [id, { choice, confidence: probabilities[choice], probabilities }];
        }),
      );
    },
  };
}

const codePick = (code: string, p = 0.98): Picked => ({ choice: code, confidence: p, probabilities: { [code]: p, NONE: 1 - p } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("reading the code", () => {
  it("takes the top code at the threshold, else the nearest broader code its kinds reach, else candidates or none", () => {
    expect(acceptCode(codePick("food.prepared.hot", 0.95))).toEqual({ code: "food.prepared.hot", confidence: 0.95 });
    // Hot or dine-in, not which: the broader code they share.
    expect(acceptCode({ choice: "food.prepared.hot", confidence: 0.5, probabilities: { "food.prepared.hot": 0.5, "food.prepared.dine_in": 0.45, NONE: 0.05 } })).toEqual({
      code: "food.prepared",
      confidence: 0.95,
    });
    expect(acceptCode({ choice: "food.candy", confidence: 0.6, probabilities: { "food.candy": 0.6, "food.grocery": 0.35, NONE: 0.05 } })).toEqual({ candidates: ["food.candy", "food.grocery"] });
    expect(acceptCode({ choice: "NONE", confidence: 0.95, probabilities: { NONE: 0.95, "goods.general": 0.05 } })).toEqual({ none: true });
    // Without probabilities, the choice at its confidence.
    expect(acceptCode({ choice: "software.saas", confidence: 0.92 })).toEqual({ code: "software.saas", confidence: 0.92 });
  });

  it("never offers nontaxable, and never shows the picker a rate, a treatment, the address or the date", async () => {
    const picker = stub([[/personal, non-business use/, 0.97]], codePick("software.saas"));
    await describedTaxability({ state: "CT", parts: ct }, { text: "a photo app for family use" }, DAY, RULES, picker);
    const words = JSON.stringify(picker.asked);
    expect(words).not.toMatch(/"nontaxable"|0\.0635|6\.35|Connecticut|2026-11-02|"(taxable|exempt|special_rate|zero_rated)"/);
  });
});

describe("settling a rule's cases from the text", () => {
  it("settles a conditional tax as the case the text describes, at the rate its outcome gives", async () => {
    const t = await describedTaxability({ state: "CT", parts: ct }, { code: "software.saas", text: "a photo-editing app for a family's personal use" }, DAY, RULES, stub([[/personal, non-business use/, 0.97]], codePick("software.saas")));
    const outcome = taxabilityOf({ state: "CT", parts: ct }, "software.saas", DAY, RULES).outcomes!.find((o) => /personal/.test(o.when))!;
    expect(t).toMatchObject({ treatment: "taxable", rate: outcome.rate, interpreted: { from: "code", code: "software.saas", conditions: [{ tax: "CT", when: ["Bought for personal, non-business use"], confidence: 0.97 }] } });
    // Its rule is shown as cited.
    expect(t.taxes[0].rule!.treatment).toBe("conditional");
    expect(TaxabilitySchema.parse(t).interpreted).toEqual(t.interpreted);
  });

  it("stays conditional, with its outcomes, when the text doesn't establish a case", async () => {
    const t = await describedTaxability({ state: "CT", parts: ct }, { code: "software.saas", text: "project app" }, DAY, RULES, stub([[/personal/, 0.5]], codePick("software.saas")));
    const asCode = taxabilityOf({ state: "CT", parts: ct }, "software.saas", DAY, RULES);
    const { interpreted, ...rest } = t;
    expect(rest).toEqual(asCode);
    expect(interpreted.conditions).toBeUndefined();
  });

  it("counts together the cases the rules treat alike", async () => {
    // Montpelier's take-and-bake pizza: two exempt cases split the picker's weight.
    const vt: RatePart[] = [{ kind: "state", name: "Vermont", code: "VT-S", rate: 0.06, ids: {} }, { kind: "city", name: "Montpelier", code: "VT-C", rate: 0.01, ids: {} }];
    const t = await describedTaxability({ state: "VT", parts: vt }, { code: "food.uncooked", text: "x" }, DAY, RULES, stub([[/^A whole uncooked pizza/, 0.5], [/prepackaged|packaged/i, 0.45]], codePick("food.uncooked")));
    expect(t).toMatchObject({ treatment: "not_taxed", rate: 0 });
  });

  it("settles paired taxes together, as one of the outcomes the rules pair, never a state case with another local one", async () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    const cases = [{ when: "A whole uncooked pizza", treatment: "exempt" }, { when: "A cooked meal", treatment: "taxable" }];
    const set = ruleSet([{ ...base, tax: "ZZ", code: "food.uncooked", treatment: "conditional", conditions: cases }, { ...base, tax: "ZZ:local", code: "food.uncooked", treatment: "conditional", conditions: cases }] as Rule[]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.06, ids: {} }, { kind: "city", name: "Zc", code: "ZZ1", rate: 0.01, ids: {} }];
    const asCode = taxabilityOf({ state: "ZZ", parts: zz }, "food.uncooked", DAY, set);
    const picker = stub([[/cooked meal/, 0.95]], codePick("food.uncooked"));
    const t = await describedTaxability({ state: "ZZ", parts: zz }, { code: "food.uncooked", text: "x" }, DAY, set, picker);
    // One question for both taxes.
    expect(Object.keys(picker.asked[0])).toEqual(["code", "case"]);
    expect(t.rate).toBe(0.07);
    expect(asCode.outcomes!.map((o) => o.rate)).toContain(t.rate);
    expect(t.interpreted.conditions?.map((c) => c.tax)).toEqual(["ZZ", "ZZ:local"]);
  });

  it("takes a settled rule's exception the text establishes, reopens the tax when the text only makes it likely, else keeps the rule", async () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    const set = ruleSet([{ ...base, tax: "ZZ", code: "food.prepared.bakery", treatment: "exempt", conditions: [{ when: "The seller packs a napkin with the item", treatment: "taxable" }] }] as Rule[]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.06, ids: {} }];
    const ask = (p: number) => describedTaxability({ state: "ZZ", parts: zz }, { code: "food.prepared.bakery", text: "x" }, DAY, set, stub([[/napkin/, p]], codePick("food.prepared.bakery")));
    expect(await ask(0.95)).toMatchObject({ treatment: "taxable", rate: 0.06 });
    const doubt = await ask(0.5);
    expect(doubt).toMatchObject({ treatment: "conditional", rate: null });
    expect(doubt.outcomes?.map((o) => o.rate)).toEqual([0, 0.06]);
    expect(TaxabilitySchema.parse(doubt)).toEqual(doubt);
    expect(await ask(0.02)).toMatchObject({ treatment: "not_taxed", rate: 0 });
  });

  it("never settles a case that turns on a money amount from a price in the text", async () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    const set = ruleSet([{ ...base, tax: "ZZ", code: "food.prepared", treatment: "conditional", conditions: [{ when: "The sale totals $4.00 or less", treatment: "exempt" }, { when: "Anything else", treatment: "taxable" }] }] as Rule[]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.06, ids: {} }];
    const t = await describedTaxability({ state: "ZZ", parts: zz }, { code: "food.prepared", text: "a $3 sandwich" }, DAY, set, stub([[/\$4\.00/, 0.99]], codePick("food.prepared")));
    expect(t.treatment).toBe("conditional");
  });
});

describe("counts", () => {
  it("are how many units are sold against a threshold, not a property of one item", () => {
    for (const w of ["sold in quantities of fewer than six", "six or more single servings", "Four or more servings packaged as one item", "Whole cakes or pies, or larger quantities"]) expect(namesCount(w), w).toBe(true);
    for (const w of ["Two or more ingredients combined by the seller", "single servings under 230 g", "in any quantity", "a container over 16 fl oz"]) expect(namesCount(w), w).toBe(false);
  });

  it("are never settled from a count in the text", async () => {
    const base = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
    const set = ruleSet([{ ...base, tax: "ZZ", code: "food.prepared.bakery", treatment: "conditional", conditions: [{ when: "Single servings sold in quantities of fewer than six", treatment: "taxable" }, { when: "Six or more single servings", treatment: "zero_rated" }] }] as Rule[]);
    const zz: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.05, ids: {} }];
    const t = await describedTaxability({ state: "ZZ", parts: zz }, { code: "food.prepared.bakery", text: "two muffins and four doughnuts" }, DAY, set, stub([[/Six or more/, 0.99]], codePick("food.prepared.bakery")));
    expect(t.treatment).toBe("conditional");
  });
});

describe("the caller's code and the text", () => {
  it("answers the code sent; a text pointing elsewhere is flagged, a broader or narrower one isn't", async () => {
    const ask = (code: string) =>
      describedTaxability({ state: "CT", parts: ct }, { code: "food.grocery", text: "hot rotisserie chicken" }, DAY, RULES, stub([], codePick(code)));
    const elsewhere = await ask("food.prepared.hot");
    expect(elsewhere.interpreted).toEqual({ from: "code", code: "food.prepared.hot", confidence: 0.98, mismatch: true });
    const { interpreted: _i, ...rest } = elsewhere;
    expect(rest).toEqual(taxabilityOf({ state: "CT", parts: ct }, "food.grocery", DAY, RULES));
    expect((await ask("food.grocery")).interpreted.mismatch).toBeUndefined();
  });

  it("without a code: no code fits is not researched; several candidates are conditional, listing them", async () => {
    const none = await describedTaxability({ state: "CT", parts: ct }, { text: "a haircut" }, DAY, RULES, stub([], { choice: "NONE", confidence: 0.97, probabilities: { NONE: 0.97 } }));
    expect(none).toEqual({ treatment: "not_researched", rate: null, taxes: [], interpreted: { from: "text", code: null } });
    const two = await describedTaxability({ state: "CT", parts: ct }, { text: "chocolate bar" }, DAY, RULES, stub([], { choice: "food.candy", confidence: 0.6, probabilities: { "food.candy": 0.6, "food.grocery": 0.4 } }));
    expect(two).toMatchObject({ treatment: "conditional", rate: null, taxes: [], interpreted: { code: null, candidates: ["food.candy", "food.grocery"] } });
    expect(TaxabilitySchema.parse(two)).toEqual(two);
  });

  it("answers as without the text, marked unavailable, when the picker can't be asked or fails", async () => {
    const asCode = taxabilityOf({ state: "CT", parts: ct }, "software.saas", DAY, RULES);
    const failing: Picker = { model: "stub", pick: async () => null };
    for (const picker of [null, failing]) {
      const t = await describedTaxability({ state: "CT", parts: ct }, { code: "software.saas", text: "x" }, DAY, RULES, picker);
      expect(t).toEqual({ ...asCode, interpreted: { from: "code", code: null, unavailable: true } });
      expect(await describedTaxability({ state: "CT", parts: ct }, { text: "x" }, DAY, RULES, picker)).toEqual({
        treatment: "conditional",
        rate: null,
        taxes: [],
        interpreted: { from: "text", code: null, unavailable: true },
        needs: ["code"],
      });
    }
  });
});

describe("the picker", () => {
  const questions = { q: { instructions: "Which?", options: { C1: "one", C2: "two", NONE: "neither" } } };
  const reply = (q: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify({ answers: { q } }), { status }));

  it("asks Jev with the text as data and the options' words only, and keeps an offered answer", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const fetch = reply({ choice: "C2", confidence: 0.9, probabilities: { C1: 0.05, C2: 0.92, NONE: 0.03 } });
    vi.stubGlobal("fetch", fetch);
    expect(await jevPicker()!.pick("two please", questions)).toEqual({ q: { choice: "C2", confidence: 0.9, probabilities: { C1: 0.05, C2: 0.92, NONE: 0.03 } } });
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.state).toBe(JSON.stringify({ description: "two please" }));
    expect(body.questions.q).toEqual({ type: "choice", instructions: "Which?", criteria: { C1: "one", C2: "two", NONE: "neither" } });
  });

  it.each([
    ["an option it wasn't offered", reply({ choice: "C3", confidence: 0.9 })],
    ["an error", reply({}, 500)],
    ["a malformed answer", reply({ choice: 3 })],
    ["a network failure", vi.fn(async () => Promise.reject(new Error("down")))],
    ["a confidence over 1", reply({ choice: "C1", confidence: 1.5 })],
    ["a negative probability", reply({ choice: "C1", confidence: 0.6, probabilities: { C1: 0.6, C2: 0.6, NONE: -0.2 } })],
    ["probabilities over 1", reply({ choice: "C1", confidence: 0.6, probabilities: { C1: 1.5, NONE: -0.5 } })],
    ["probabilities that don't sum to 1", reply({ choice: "C1", confidence: 0.6, probabilities: { C1: 0.6, C2: 0.6, NONE: 0 } })],
    ["a probability that isn't finite", reply({ choice: "C1", confidence: 0.6, probabilities: { C1: Number.NaN } })],
  ])("is no answer on %s", async (_, fetch) => {
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetch);
    expect(await jevPicker()!.pick("x", questions)).toBeNull();
  });

  it("isn't there without a key", () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(jevPicker()).toBeNull();
  });

  it("answers a repeat from its cache, and asks only when a budget pays", async () => {
    let calls = 0;
    const inner: Picker = { model: "m", pick: async (_t, qs) => (calls++, Object.fromEntries(Object.keys(qs).map((id) => [id, { choice: "C1", confidence: 1 }]))) };
    const cached = cachedPicker(inner, memoryStore());
    await cached.pick("a", questions);
    await cached.pick("a", questions);
    expect(calls).toBe(1);
    await cached.pick("b", questions);
    expect(calls).toBe(2);
    expect(await paidPicker(inner, async () => false).pick("c", questions)).toBeNull();
    expect(calls).toBe(2);
  });
});

describe("requests without describe=", () => {
  it("are answered exactly as before: no Jev call, no new field, the same cache key", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("TYPESAFE_API_KEY", "test-key");
    const { app } = await import("../src/server.js");
    const response = await app.request("/v1/rate?state=DC&street=1350+Pennsylvania+Ave+NW&city=Washington&date=2026-10-21&code=food.prepared.hot");
    const body = (await response.json()) as { taxability: Record<string, Described> };
    expect(Object.keys(body.taxability)).toEqual(["food.prepared.hot"]);
    expect(body.taxability["food.prepared.hot"].interpreted).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
    const q = { state: "DC", street: "1 Main St", city: "Washington", date: "2026-10-21" };
    expect(answerKey(q, [])).toBe("DC|1 MAIN ST|WASHINGTON||2026-10-21|");
    expect(answerKey({ ...q, codes: ["food.grocery"] }, [])).toBe("DC|1 MAIN ST|WASHINGTON||2026-10-21||food.grocery");
    expect(answerKey({ ...q, describe: "milk" }, [])).toBe("DC|1 MAIN ST|WASHINGTON||2026-10-21||describe:milk");
  });

  it("describe= needs a key; beside two codes it is a bad request; alone, it answers under the text, unavailable without Jev", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    const MASTER = `otr_master_${"d4".repeat(24)}`;
    vi.stubEnv("OPENTAXRATE_MASTER_KEYS", `test=${MASTER}`);
    vi.resetModules();
    const { app } = await import("../src/server.js");
    const keyed = { headers: { authorization: `Bearer ${MASTER}` } };
    const DC = "/v1/rate?state=DC&street=1350+Pennsylvania+Ave+NW&city=Washington&date=2026-10-21";
    const open = await app.request(`${DC}&describe=milk`);
    expect(open.status).toBe(403);
    expect(await open.json()).toMatchObject({ code: "KEY_REQUIRED" });
    expect((await app.request(`${DC}&code=food.grocery,food.candy&describe=milk`, keyed)).status).toBe(400);
    const response = await app.request(`${DC}&describe=${encodeURIComponent("a gallon of milk")}`, keyed);
    const body = (await response.json()) as { taxability: Record<string, Described> };
    expect(body.taxability).toEqual({ "a gallon of milk": { treatment: "conditional", rate: null, taxes: [], interpreted: { from: "text", code: null, unavailable: true }, needs: ["code"] } });
  });
});

describe("questions", () => {
  it("offer a broad code's kinds by their own definitions, and an exception as an exception", () => {
    const ky: RatePart[] = [{ kind: "state", name: "Kentucky", code: "21", rate: 0.06, ids: {} }];
    const t = taxabilityOf({ state: "KY", parts: ky }, "service.professional", "2026-10-30", RULES);
    const words = Object.values(asQuestions(caseQuestions(t), "service.professional")).flatMap((q) => Object.values(q.options));
    expect(words).toContain("Lobbying a government on the customer's behalf");
    expect(words.some((w) => /^service\./.test(w))).toBe(false);
  });
});

const BASE = { from: "2020-01-01", fromIs: "effective" as const, summary: "A test rule, nothing more.", citations: [{ title: "t", url: "https://example.gov/t" }] };
const ZZ: RatePart[] = [{ kind: "state", name: "Z", code: "ZZ", rate: 0.06, ids: {} }];

describe("review fixes", () => {
  // Codex 1: a settled rule whose exception the text doesn't exclude.
  const tile = ruleSet([{ ...BASE, tax: "ZZ", code: "construction.real_property.improvement.flooring", treatment: "taxable", conditions: [{ when: "The floor is ceramic tile", treatment: "exempt" }] }] as Rule[]);
  const flooring = "construction.real_property.improvement.flooring";

  it("a text-chosen code never leaves a rate its rule's exception may change: NONE or a failed call keeps it open", async () => {
    const none = await describedTaxability({ state: "ZZ", parts: ZZ }, { text: "new flooring" }, DAY, tile, stub([], codePick(flooring, 1)));
    expect(none).toMatchObject({ treatment: "conditional", rate: null });
    expect(none.outcomes?.map((o) => o.rate)).toEqual([0.06, 0]);
    // Excluded affirmatively, the usual case stands.
    const kept = await describedTaxability({ state: "ZZ", parts: ZZ }, { text: "new carpet" }, DAY, tile, stub([[/none of the other options/, 0.97]], codePick(flooring, 1)));
    expect(kept).toMatchObject({ treatment: "taxable", rate: 0.06 });
    // A failure after the code was read is a failure, as before it.
    let call = 0;
    const failsSecond: Picker = { model: "stub", pick: async (_t, qs) => (call++ ? null : { code: codePick(flooring, 1) }) };
    expect(await describedTaxability({ state: "ZZ", parts: ZZ }, { text: "new flooring" }, DAY, tile, failsSecond)).toEqual({
      treatment: "conditional", rate: null, taxes: [], interpreted: { from: "text", code: flooring, unavailable: true }, needs: ["code"],
    });
  });

  it("the caller's code keeps its usual case unless the text makes an exception likely", async () => {
    const t = await describedTaxability({ state: "ZZ", parts: ZZ }, { code: flooring, text: "new flooring" }, DAY, tile, stub([], codePick(flooring, 1)));
    expect(t).toMatchObject({ treatment: "taxable", rate: 0.06 });
  });

  it("a text that points away from the code sent settles none of its cases (Muse F1)", async () => {
    const set = ruleSet([{ ...BASE, tax: "ZZ", code: "food.prepared.bakery", treatment: "conditional", conditions: [{ when: "Sold with utensils", treatment: "taxable" }, { when: "Sold without utensils", treatment: "exempt" }] }] as Rule[]);
    const t = await describedTaxability({ state: "ZZ", parts: ZZ }, { code: "food.prepared.bakery", text: "a gallon of milk" }, DAY, set, stub([[/without utensils/, 0.97]], codePick("food.grocery")));
    expect(t).toMatchObject({ treatment: "conditional", interpreted: { mismatch: true } });
    expect(t.interpreted.conditions).toBeUndefined();
  });

  it("never settles a fact a description can't carry, and names it in needs (Muse F2)", async () => {
    expect(needsOf("Sold by a seller whose prepared food sales exceed 75% of its food sales")).toEqual(["seller_kind"]);
    expect(needsOf("Seller meets the 80-80 rule at that location")).toEqual(["seller_kind"]);
    expect(needsOf("The town levies the 1% local option meals tax")).toEqual(["locality"]);
    expect(needsOf("paid for in full during the break (Dec 14, 2024 – Feb 15, 2025)")).toEqual(["payment_date"]);
    expect(needsOf("The delivery charge is incurred after title has passed to the buyer")).toEqual(["title_transfer"]);
    expect(needsOf("Non-residential prime contract over $10,000")).toEqual(["contract_total"]);
    expect(needsOf("A restaurant sells a hot meal")).toEqual([]);
    const set = ruleSet([{ ...BASE, tax: "ZZ", code: "food.prepared.bakery", treatment: "conditional", conditions: [{ when: "The seller's prepared food sales exceed 75% of its food sales", treatment: "taxable" }, { when: "The seller's prepared food sales are 75% or less of its food sales", treatment: "exempt" }] }] as Rule[]);
    const picker = stub([[/75% or less/, 0.99]], codePick("food.prepared.bakery"));
    const t = await describedTaxability({ state: "ZZ", parts: ZZ }, { code: "food.prepared.bakery", text: "a grocery sells doughnuts" }, DAY, set, picker);
    expect(t).toMatchObject({ treatment: "conditional", needs: ["seller_kind"] });
    // Not asked at all: no option of it may be settled.
    expect(Object.keys(picker.asked[0])).toEqual(["code"]);
    expect(TaxabilitySchema.parse(t).needs).toEqual(["seller_kind"]);
  });

  it("accepts a pick at the threshold despite rounding, and an exactly 0.1 doubt doesn't reopen (Muse F7)", async () => {
    const set = ruleSet([{ ...BASE, tax: "ZZ", code: "food.prepared.bakery", treatment: "exempt", conditions: [{ when: "Sold with utensils", treatment: "taxable" }] }] as Rule[]);
    const at = (keep: number, other: number): Picker => ({
      model: "stub",
      pick: async (_t, qs) => Object.fromEntries(Object.keys(qs).map((id) => [id, id === "code" ? codePick("food.prepared.bakery") : { choice: "C1", confidence: keep, probabilities: { C1: keep, C2: other, NONE: Math.max(0, 1 - keep - other) } }])),
    });
    expect(await describedTaxability({ state: "ZZ", parts: ZZ }, { code: "food.prepared.bakery", text: "x" }, DAY, set, at(0.85, 0.1))).toMatchObject({ treatment: "not_taxed" });
    expect(acceptCode({ choice: "food.candy", confidence: 0.3 + 0.6, probabilities: { "food.candy": 0.3 + 0.6, NONE: 0.1 } })).toMatchObject({ code: "food.candy" });
  });

  it("an UNCLEAR-dominated pick lists no candidates (Muse F8), and confidence never exceeds 1", () => {
    expect(acceptCode({ choice: "UNCLEAR", confidence: 0.9, probabilities: { UNCLEAR: 0.9, "food.candy": 0.06, NONE: 0.04 } })).toEqual({ candidates: [] });
    // Probabilities a little over 1 after rounding never report over 1.
    expect(acceptCode({ choice: "food.candy", confidence: 1, probabilities: { "food.candy": 1.004 } })).toEqual({ code: "food.candy", confidence: 1 });
  });

  it("reports every case the rules treat alike that the pooled confidence supports (Codex 4)", async () => {
    const set = ruleSet([{ ...BASE, tax: "ZZ", code: "food.uncooked", treatment: "conditional", conditions: [{ when: "A whole uncooked pizza", treatment: "exempt" }, { when: "Other food to cook, prepackaged", treatment: "exempt" }, { when: "A meal", treatment: "taxable" }] }] as Rule[]);
    const t = await describedTaxability({ state: "ZZ", parts: ZZ }, { code: "food.uncooked", text: "x" }, DAY, set, stub([[/whole uncooked pizza/, 0.5], [/prepackaged/, 0.45]], codePick("food.uncooked")));
    expect(t.interpreted.conditions).toEqual([{ tax: "ZZ", when: ["A whole uncooked pizza", "Other food to cook, prepackaged"], confidence: 0.95 }]);
  });

  it("offers a broad rule's residual as what the listed kinds aren't, not the global .other definition (Codex 5)", () => {
    const set = ruleSet([
      { ...BASE, tax: "ZZ", code: "service.professional", treatment: "exempt", conditions: [] },
      { ...BASE, tax: "ZZ", code: "service.professional.advertising", treatment: "taxable", conditions: [] },
    ] as Rule[]);
    const t = taxabilityOf({ state: "ZZ", parts: ZZ }, "service.professional", DAY, set);
    const words = Object.values(asQuestions(caseQuestions(t), "service.professional")).flatMap((q) => Object.values(q.options));
    expect(words.some((w) => /other than the kinds named in the other options/.test(w))).toBe(true);
    expect(words.some((w) => /not legal, accounting/.test(w))).toBe(false);
  });

  it("scores a statewide place at its real rate, so a case can expect the rate its source states (Codex 2)", () => {
    expect(partsAt("CT", "2026-06-15")[0].rate).toBe(0.0635);
    expect(partsAt("NY", "2026-06-15").map((p) => p.rate)).toEqual([0.04, 0.02]);
    expect(halfOf({ place: "CT", id: "ct-07" })).toBe(halfOf({ place: "CT", id: "ct-07" }));
  });
});
