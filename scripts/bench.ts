/**
 * Accuracy comparison: the same addresses, asked of opentaxrate and of other
 * rate services, judged by each state's official answer.
 *
 *   tsx scripts/bench.ts ask <provider> [--budget N] [--pick disputed|sample]
 *                            [--per-state N] [--states TX,WA] [--ids a,b]
 *   tsx scripts/bench.ts report
 *   tsx scripts/bench.ts geocode [--provider ID] [--per-state N] [--budget N]
 *
 * Cases are the CSVs in artifacts/bench/cases (state,street,city,zip,date,
 * expected,source[,lon,lat,notes]); `expected` is the state's own answer.
 * Every provider samples the same addresses: each state's cases in one fixed
 * shuffled order, the first N of it. Every answer, with the provider's raw
 * response, is appended to artifacts/bench/answers/<provider>.jsonl and never
 * asked again, so a free plan's calls are spent once and kept for later
 * cross-checks. Keys come from the environment (run under `infisical run`);
 * they are never written out.
 *
 * Paid services are asked at most PAID_CALLS_PER_RUN addresses a run, so
 * spend them where they settle something: `--pick disputed` asks first about
 * addresses where the answers kept so far disagree with the state's or with
 * each other. Every run's spend is logged to artifacts/bench/usage.jsonl.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../artifacts/bench/", import.meta.url).pathname;
/** BENCH_CASES and BENCH_ANSWERS point at another set (a pool split), whose
 *  rows may not have an expected rate yet: they are asked, not scored. */
const CASES = process.env.BENCH_CASES || path.join(ROOT, "cases");
const ANSWERS = process.env.BENCH_ANSWERS || path.join(ROOT, "answers");
const USAGE = path.join(ROOT, "usage.jsonl");
/** Paid calls per service per run; raise it per run with
 *  BENCH_PAID_CALLS_PER_RUN when a budget has been agreed. */
const PAID_CALLS_PER_RUN = Number(process.env.BENCH_PAID_CALLS_PER_RUN || 10);
/** Rates within half a hundredth of a percent agree: some services round
 *  New Mexico's 6.4375% to 6.438%. */
const SAME_RATE = 5e-5;

interface Case {
  id: string;
  state: string;
  street: string;
  city: string;
  zip: string;
  date: string;
  expected: number;
  source: string;
  lon?: number;
  lat?: number;
}

/** A rate, or a refusal (the service declined or couldn't place the address). */
type Answer = { rate: number; raw?: unknown } | { refused: string; raw?: unknown };

interface Provider {
  /** Environment variables it needs; it is skipped without them. */
  needs: string[];
  /** Pause between calls, for the service's rate limit. */
  pauseMs: number;
  /** Asked again every run: opentaxrate's own answers change with its code. */
  fresh?: boolean;
  ask(c: Case): Promise<Answer>;
}

const env = (k: string) => process.env[k] ?? "";

async function json(response: Response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { status: response.status, text: text.slice(0, 500) };
  }
}

const PROVIDERS: Record<string, Provider> = {
  /** The full pipeline: every configured geocoder, then the engine. The
   *  bench measures accuracy, not quota, so geocoder calls are neither
   *  rationed nor cached in the database it reads. */
  opentaxrate: { needs: [], pauseMs: 0, fresh: true, ask: (c) => pipeline(c) },
  /** The same, for iterating on the engine: each provider's answer for each
   *  address is asked once and replayed from BENCH_GEOCODE_REPLAY after. */
  "opentaxrate-dev": { needs: ["BENCH_GEOCODE_REPLAY"], pauseMs: 0, fresh: true, ask: (c) => pipeline(c, env("BENCH_GEOCODE_REPLAY")) },
  /** The public tier: a lookup without a key, limited to
   *  OPENTAXRATE_PUBLIC_PROVIDERS (photon,pelias when unset here). */
  "opentaxrate-public": {
    needs: [],
    pauseMs: 0,
    fresh: true,
    ask: (c) => pipeline(c, undefined, process.env.OPENTAXRATE_PUBLIC_PROVIDERS || "photon,pelias"),
  },
  /** The engine alone, at the case's own address point. */
  "opentaxrate-point": {
    needs: [],
    pauseMs: 0,
    fresh: true,
    async ask(c) {
      if (c.lon === undefined || c.lat === undefined) return { refused: "no point in case" };
      const { addressRates } = await import("../src/rates/index.js");
      const point = { lon: c.lon, lat: c.lat, accuracy: "rooftop" as const };
      return addressRates.at({ ...c, locate: async () => point }, c.date).then(
        (r) => ({ rate: r.rate, raw: { match: r.match, locationCode: r.locationCode } }),
        (e: Error) => ({ refused: e.message }),
      );
    },
  },
  taxcloud: {
    needs: ["TAXCLOUD_API_KEY", "TAXCLOUD_CONNECTION_ID"],
    pauseMs: 300,
    async ask(c) {
      const address = { line1: c.street, city: c.city, state: c.state, zip: c.zip, countryCode: "US" };
      const response = await fetch(
        `https://api.v3.taxcloud.com/tax/connections/${env("TAXCLOUD_CONNECTION_ID")}/carts`,
        {
          method: "POST",
          headers: { "X-API-KEY": env("TAXCLOUD_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [
              {
                customerId: "opentaxrate-bench",
                currency: { currencyCode: "USD" },
                origin: address,
                destination: address,
                lineItems: [{ index: 0, itemId: "general", price: 100, quantity: 1, tic: 0 }],
              },
            ],
          }),
        },
      );
      const raw = await json(response);
      const tax = raw?.items?.[0]?.lineItems?.[0]?.tax;
      return response.ok && typeof tax?.rate === "number"
        ? { rate: round(tax.rate), raw }
        : { refused: `${response.status} ${raw?.detail ?? raw?.title ?? ""}`, raw };
    },
  },
  avalara: {
    needs: ["AVALARA_ACCOUNT_ID", "AVALARA_LICENSE_KEY"],
    pauseMs: 1_000,
    async ask(c) {
      const host = env("AVALARA_SANDBOX") ? "sandbox-rest.avatax.com" : "rest.avatax.com";
      const url = new URL(`https://${host}/api/v2/taxrates/byaddress`);
      url.search = new URLSearchParams({ line1: c.street, city: c.city, region: c.state, postalCode: c.zip, country: "US" }).toString();
      const auth = Buffer.from(`${env("AVALARA_ACCOUNT_ID")}:${env("AVALARA_LICENSE_KEY")}`).toString("base64");
      // AvaTax's rate lookup answers an intermittent 500 RemoteServerError
      // that a retry a second later clears.
      let response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      for (let retry = 0; response.status >= 500 && retry < 3; retry++) {
        await new Promise((r) => setTimeout(r, 1_000));
        response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      }
      const raw = await json(response);
      return response.ok && typeof raw?.totalRate === "number"
        ? { rate: round(raw.totalRate), raw }
        : { refused: `${response.status} ${raw?.error?.message ?? ""}`, raw };
    },
  },
  /** TaxCloud's v1 Lookup: a tax amount on a $100 item, so the rate is the
   *  amount / 100. It answers $0 where the account doesn't collect, so $0 is
   *  "not collecting" except in states with no sales tax (Alaska has local ones). */
  "taxcloud-v1": {
    needs: ["TAXCLOUD_V1_LOGIN_ID", "TAXCLOUD_V1_API_KEY"],
    pauseMs: 300,
    async ask(c) {
      const address = { Address1: c.street, City: c.city, State: c.state, Zip5: c.zip.slice(0, 5) };
      const response = await fetch("https://api.taxcloud.net/1.0/TaxCloud/Lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiLoginID: env("TAXCLOUD_V1_LOGIN_ID"), apiKey: env("TAXCLOUD_V1_API_KEY"),
          customerID: "opentaxrate-bench", cartID: `bench-${c.id}`, deliveredBySeller: false,
          origin: address, destination: address,
          cartItems: [{ Index: 0, ItemID: "general", TIC: 0, Price: 100, Qty: 1 }],
        }),
      });
      const raw = await json(response);
      const amount = raw?.CartItemsResponse?.[0]?.TaxAmount;
      if (!response.ok || raw?.ResponseType !== 3 || typeof amount !== "number")
        return { refused: `${response.status} ${raw?.Messages?.[0]?.Message ?? ""}`, raw };
      if (amount === 0 && !["DE", "MT", "NH", "OR"].includes(c.state)) return { refused: "$0: the account has no nexus set for this state", raw };
      return { rate: round(amount / 100), raw };
    },
  },
  taxjar: {
    needs: ["TAXJAR_API_TOKEN"],
    pauseMs: 300,
    async ask(c) {
      // TAXJAR_SANDBOX=1: the sandbox answers the same rates and doesn't bill.
      const sandbox = Boolean(env("TAXJAR_SANDBOX"));
      const url = new URL(`https://${sandbox ? "api.sandbox.taxjar.com" : "api.taxjar.com"}/v2/rates/${c.zip.slice(0, 5)}`);
      url.search = new URLSearchParams({ street: c.street, city: c.city, state: c.state, country: "US" }).toString();
      const token = sandbox ? env("TAXJAR_SANDBOX_API_TOKEN") : env("TAXJAR_API_TOKEN");
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const raw = await json(response);
      const rate = Number(raw?.rate?.combined_rate);
      return response.ok && Number.isFinite(rate)
        ? { rate: round(rate), raw }
        : { refused: `${response.status} ${raw?.detail ?? raw?.error ?? ""}`, raw };
    },
  },
  /** Zip-Tax allows 10 requests a minute, and the account's plan a fixed
   *  number in all (see /account/v60/metrics). */
  ziptax: {
    needs: ["ZIPTAX_API_KEY"],
    pauseMs: 6_500,
    async ask(c) {
      const url = new URL("https://api.zip-tax.com/request/v60");
      url.search = new URLSearchParams({ address: `${c.street}, ${c.city}, ${c.state} ${c.zip}` }).toString();
      const response = await fetch(url, { headers: { "X-API-KEY": env("ZIPTAX_API_KEY") } });
      const raw = await json(response);
      const summary = (raw?.taxSummaries ?? []).find((s: { summaryName?: string; taxType?: string }) =>
        /sales/i.test(`${s.summaryName} ${s.taxType}`),
      );
      const rate = Number(summary?.rate);
      return response.ok && Number.isFinite(rate)
        ? { rate: round(rate), raw }
        : { refused: `${response.status} ${raw?.metadata?.response?.message ?? ""}`, raw };
    },
  },
  /** Lovat takes a ZIP, not a street. A seller in the same ZIP makes the
   *  sale domestic, so the answer is that ZIP's rate (a seller elsewhere
   *  gets 0% where it has no nexus). */
  lovat: {
    needs: ["LOVAT_API_KEY"],
    pauseMs: 300,
    async ask(c) {
      const zip = c.zip.slice(0, 5);
      const response = await fetch(`https://merchant.vatcompliance.co/api/1/tax_rate/${env("LOVAT_API_KEY")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transaction_id: c.id, currency: "USD", transaction_sum: 100,
          arrival_country: "USA", arrival_state: c.state, arrival_zip: zip,
          departure_country: "USA", departure_state: c.state, departure_zip: zip,
        }),
      });
      const raw = await json(response);
      return response.ok && typeof raw?.tax_rate === "number"
        ? { rate: round(raw.tax_rate / 100), raw }
        : { refused: `${response.status} ${raw?.error ?? ""}`, raw };
    },
  },
  /** APIVerve's sales tax API takes a ZIP code, not a street, and its free
   *  plan has 200 credits in all and allows 5 requests at a time. */
  apiverve: {
    needs: ["APIVERVE_API_KEY"],
    pauseMs: 1_500,
    async ask(c) {
      const url = new URL("https://api.apiverve.com/v1/salestax");
      url.search = new URLSearchParams({ zip: c.zip.slice(0, 5) }).toString();
      const response = await fetch(url, { headers: { "x-api-key": env("APIVERVE_API_KEY") } });
      const raw = await json(response);
      const rate = Number(raw?.data?.rate);
      return response.ok && raw?.status === "ok" && Number.isFinite(rate)
        ? { rate: round(rate), raw }
        : { refused: `${response.status} ${raw?.error ?? ""}`, raw };
    },
  },
  /** Stripe Tax in test mode; needs Tax turned on for the account. */
  stripe: {
    needs: ["STRIPE_SECRET_KEY"],
    pauseMs: 300,
    async ask(c) {
      const form = new URLSearchParams({
        currency: "usd",
        "line_items[0][amount]": "10000",
        "line_items[0][reference]": "general",
        "line_items[0][tax_code]": "txcd_99999999",
        "customer_details[address_source]": "shipping",
        "customer_details[address][line1]": c.street,
        "customer_details[address][city]": c.city,
        "customer_details[address][state]": c.state,
        "customer_details[address][postal_code]": c.zip,
        "customer_details[address][country]": "US",
      });
      const response = await fetch("https://api.stripe.com/v1/tax/calculations", {
        method: "POST",
        headers: { Authorization: `Bearer ${env("STRIPE_SECRET_KEY")}` },
        body: form,
      });
      const raw = await json(response);
      if (!response.ok) return { refused: `${response.status} ${raw?.error?.message ?? ""}`, raw };
      const breakdown: Array<{ taxability_reason: string; tax_rate_details?: { percentage_decimal: string } }> =
        raw.tax_breakdown ?? [];
      if (breakdown.some((b) => b.taxability_reason === "not_collecting"))
        return { refused: "not collecting in this state", raw };
      const rate = breakdown.reduce((sum, b) => sum + Number(b.tax_rate_details?.percentage_decimal ?? 0), 0) / 100;
      return { rate: round(rate), raw };
    },
  },
};

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** With BENCH_LOOKUP_REPLAY, the live services an answer depends on besides
 *  the geocoders (the states' lookups, California's, the Census's check of
 *  a lone point's ZIP and place, and Jev's street pick) are asked once per
 *  request and answered from that file after, so a tuning trial isn't moved
 *  by a timeout. A failed call isn't kept. The file is re-read and written
 *  straight after each answer, with no wait between, so answers arriving at
 *  once (a lookup's five margin probes) are all kept. */
const LIVE_HOSTS = ["missouri.atr.avalara.com", "alaska.atr.avalara.com", "salestaxlookup.colorado.gov",
  "services.maps.cdtfa.ca.gov", "geocoding.geo.census.gov/geocoder/geographies", "api.typesafe.ai"];
let liveReplayed = false;
function replayLiveServices(file: string) {
  if (liveReplayed) return;
  liveReplayed = true;
  const live = globalThis.fetch;
  const read = (): Record<string, { status: number; body: string }> =>
    fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!LIVE_HOSTS.some((h) => url.includes(h))) return live(input, init);
    const key = `${init?.method ?? "GET"} ${url} ${typeof init?.body === "string" ? init.body : ""}`;
    let hit = read()[key];
    if (!hit) {
      const response = await live(input, init);
      const body = await response.text();
      if (!response.ok) return new Response(body, { status: response.status });
      hit = { status: response.status, body };
      const kept = read();
      kept[key] = hit;
      fs.writeFileSync(file, JSON.stringify(kept));
    }
    return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

async function pipeline(c: Case, replayFile?: string, publicProviders?: string): Promise<Answer> {
  if (process.env.BENCH_LOOKUP_REPLAY) replayLiveServices(process.env.BENCH_LOOKUP_REPLAY);
  const { addressRates } = await import("../src/rates/index.js");
  const { createLocator } = await import("../src/geocoding/locator.js");
  const { geocoderProviders } = await import("../src/geocoding/registry.js");
  const { addressStandardizer } = await import("../src/standardize/index.js");
  const { EVERY_PROVIDER, policyFor } = await import("../src/access.js");
  const policy = publicProviders
    ? policyFor({ tier: "public" }, { OPENTAXRATE_PUBLIC_PROVIDERS: publicProviders })
    : EVERY_PROVIDER;
  const replay: Record<string, unknown> = replayFile && fs.existsSync(replayFile) ? JSON.parse(fs.readFileSync(replayFile, "utf8")) : {};
  const providers = geocoderProviders(policy).map((p) => !replayFile ? p : {
    ...p,
    async geocode(a: typeof c, signal: AbortSignal) {
      const key = `${p.id}|${c.id}`;
      // A failure (a spent quota, an outage) isn't kept: replayed, it would
      // trip the provider's breaker on every later run.
      if (!(key in replay)) {
        replay[key] = await p.geocode(a, signal);
        fs.writeFileSync(replayFile, JSON.stringify(replay));
      }
      const r = replay[key] as { failed?: string } | null;
      if (r && "failed" in r) throw new Error(r.failed);
      return r as never;
    },
  });
  // Geocodio's free tier is daily and shared with standardization, so its
  // calls go through the shared budget (GEOCODIO_DAILY_CAP); the rest are
  // unmetered for a benchmark.
  const { postgresGeocodeBudget } = await import("../src/geocoding/budget.js");
  const locate = createLocator(c, {
    providers,
    budget: {
      reserve: async (p) => (p.id === "geocodio" ? postgresGeocodeBudget.reserve(p) : true),
      success: (p) => postgresGeocodeBudget.success(p),
      failure: (p, e) => postgresGeocodeBudget.failure(p, e),
    },
    cache: { get: async () => undefined, put: async () => {} },
  });
  const standardizer = addressStandardizer(policy);
  const standardize = standardizer && (async () => {
    if (!replayFile) return standardizer(c);
    const key = `standardize|${c.id}`;
    // Only a found ZIP+4 is kept: the standardizer gives none both for no
    // match and for a failed call, and a failure mustn't stick.
    if (replay[key]) return replay[key] as Awaited<ReturnType<typeof standardizer>>;
    const found = await standardizer(c);
    if (found) {
      replay[key] = found;
      fs.writeFileSync(replayFile, JSON.stringify(replay));
    }
    return found;
  });
  return addressRates.at({ ...c, locate, standardize, pickStreet: policy.allows("jev") ? undefined : null }, c.date).then(
    (r) => ({ rate: r.rate, raw: { match: r.match, locationCode: r.locationCode, source: r.source, geocoders: locate.trace } }),
    (e: Error) => ({ refused: e.message, raw: { geocoders: locate.trace } }),
  );
}

const notAboutAddress = (a: Answer): a is { refused: string } =>
  "refused" in a && /^(error:|40[13] |429 |5\d\d )|isn’t active|not active|not collecting/i.test(a.refused);

// ---------------------------------------------------------------------------

function loadCases(): Case[] {
  const cases = new Map<string, Case>();
  for (const file of fs.readdirSync(CASES).filter((f) => f.endsWith(".csv")).sort()) {
    const [header, ...lines] = fs.readFileSync(path.join(CASES, file), "utf8").trim().split(/\r?\n/);
    const at = Object.fromEntries(header.split(",").map((h, i) => [h.trim(), i]));
    for (const line of lines) {
      const f = line.split(",");
      const c = {
        state: f[at.state].trim().toUpperCase(),
        street: f[at.street].trim(),
        city: f[at.city].trim(),
        zip: (f[at.zip] ?? "").trim(),
        date: (f[at.date] || "2026-10-21").trim(),
        expected: Number(f[at.expected]),
        source: f[at.source]?.trim() || file,
        lon: at.lon !== undefined && f[at.lon] ? Number(f[at.lon]) : undefined,
        lat: at.lat !== undefined && f[at.lat] ? Number(f[at.lat]) : undefined,
      };
      if (!Number.isFinite(c.expected) && !process.env.BENCH_CASES) continue;
      const id = hash(`${c.state}|${c.street}|${c.city}|${c.zip}|${c.date}`.toUpperCase());
      if (!cases.has(id)) cases.set(id, { id, ...c });
    }
  }
  return [...cases.values()];
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** Each state's cases in one fixed shuffled order, the same for every provider. */
function sample(cases: Case[], perState: number, states?: string[]) {
  const byState = new Map<string, Case[]>();
  for (const c of cases) {
    if (states && !states.includes(c.state)) continue;
    byState.set(c.state, [...(byState.get(c.state) ?? []), c]);
  }
  return [...byState.values()].flatMap((list) =>
    list.sort((a, b) => hash(`bench1|${a.id}`).localeCompare(hash(`bench1|${b.id}`))).slice(0, perState),
  );
}

function loadAnswers(provider: string): Map<string, Answer & { at: string }> {
  const file = path.join(ANSWERS, `${provider}.jsonl`);
  if (!fs.existsSync(file)) return new Map();
  return new Map(
    fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .map((a) => [a.id, a]),
  );
}

/** Addresses whose kept answers disagree with the state's or with each
 *  other first, those with the most disagreeing answers earliest. */
function disputedFirst(cases: Case[]) {
  const kept = Object.keys(PROVIDERS).map((p) => loadAnswers(p));
  const disputes = (c: Case) => {
    const rates = kept.flatMap((answers) => {
      const a = answers.get(c.id);
      return a && "rate" in a ? [a.rate] : [];
    });
    return rates.filter((r) => Math.abs(r - c.expected) >= SAME_RATE).length +
      (rates.some((r) => rates.some((s) => Math.abs(r - s) >= SAME_RATE)) ? 1 : 0);
  };
  return cases
    .map((c) => ({ c, d: disputes(c) }))
    .filter((x) => x.d > 0)
    .sort((a, b) => b.d - a.d || a.c.id.localeCompare(b.c.id))
    .map((x) => x.c);
}

interface AskOptions {
  budget: number;
  pick: "disputed" | "sample";
  perState: number;
  states?: string[];
  ids?: string[];
}

async function ask(provider: string, o: AskOptions) {
  const { perState, states } = o;
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider ${provider}; one of ${Object.keys(PROVIDERS).join(", ")}`);
  const missing = p.needs.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`${provider} needs ${missing.join(", ")}`);
  fs.mkdirSync(ANSWERS, { recursive: true });
  if (p.fresh && !states) fs.rmSync(path.join(ANSWERS, `${provider}.jsonl`), { force: true });
  const done = loadAnswers(provider);
  const all = loadCases().filter((c) => !states || states.includes(c.state));
  const candidates = o.ids
    ? all.filter((c) => o.ids!.includes(c.id))
    : o.pick === "disputed"
      ? disputedFirst(all)
      : sample(all, perState, states);
  const todo = candidates.filter((c) => !done.has(c.id));
  const budget = p.fresh ? o.budget : Math.min(o.budget, PAID_CALLS_PER_RUN);
  const out = fs.createWriteStream(path.join(ANSWERS, `${provider}.jsonl`), { flags: "a" });
  let asked = 0;
  for (const c of todo.slice(0, budget)) {
    // A busy or rate-limited service is asked again, waiting longer each time.
    let answer: Answer = { refused: "" };
    for (let attempt = 0; attempt < 5; attempt++) {
      answer = await p.ask(c).catch((e: Error) => ({ refused: `error: ${e.message}` }));
      if (!("refused" in answer) || !/^(429|5\d\d) /.test(answer.refused)) break;
      await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
    }
    // An account or service failure says nothing about the address: it is
    // not kept, so it is asked again next run. An account failure (auth,
    // rate limit) stops the run; a server error skips just that address.
    if (notAboutAddress(answer)) {
      if (/^5\d\d /.test(answer.refused)) {
        console.log(`${provider}: skipped ${c.state} ${c.street}, ${answer.refused.slice(0, 120)}`);
        continue;
      }
      console.log(`${provider}: stopped, ${answer.refused.slice(0, 200)}`);
      break;
    }
    out.write(`${JSON.stringify({ id: c.id, state: c.state, at: new Date().toISOString(), ...answer })}\n`);
    asked++;
    if (asked % 25 === 0) console.log(`${provider}: ${asked}/${Math.min(budget, todo.length)}`);
    if (p.pauseMs) await new Promise((r) => setTimeout(r, p.pauseMs));
  }
  out.end();
  if (!p.fresh)
    fs.appendFileSync(USAGE, `${JSON.stringify({ provider, at: new Date().toISOString(), asked, pick: o.ids ? "ids" : o.pick })}\n`);
  console.log(`${provider}: asked ${asked}, ${todo.length - asked} left in the sample, ${done.size + asked} kept`);
}

/** Per state and provider: of the sampled cases it was asked, the share it
 *  got right, and the share it refused. Right is within SAME_RATE of the state's. */
function report() {
  const cases = new Map(loadCases().map((c) => [c.id, c]));
  const providers = Object.keys(PROVIDERS).filter((p) => fs.existsSync(path.join(ANSWERS, `${p}.jsonl`)));
  const rows = new Map<string, Record<string, { n: number; right: number; refused: number }>>();
  for (const p of providers)
    for (const a of loadAnswers(p).values()) {
      const c = cases.get(a.id);
      if (!c) continue;
      for (const key of [c.state, "All"]) {
        const row = rows.get(key) ?? {};
        const cell = (row[p] ??= { n: 0, right: 0, refused: 0 });
        cell.n++;
        if ("refused" in a) cell.refused++;
        else if (Math.abs(a.rate - c.expected) < SAME_RATE) cell.right++;
        rows.set(key, row);
      }
    }
  const keys = [...rows.keys()].filter((k) => k !== "All").sort().concat("All");
  const table = keys.map((k) => ({
    row: k,
    cells: Object.fromEntries(
      providers.map((p) => {
        const c = rows.get(k)![p];
        return [p, c ? { n: c.n, right: c.right / c.n, refused: c.refused / c.n } : null];
      }),
    ),
  }));
  fs.writeFileSync(path.join(ROOT, "report.json"), JSON.stringify({ providers, table }, null, 2));
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(["state", ...providers].join("\t"));
  for (const r of table)
    console.log(
      [r.row, ...providers.map((p) => (r.cells[p] ? `${pct(r.cells[p]!.right)} (${pct(r.cells[p]!.refused)} ref, n=${r.cells[p]!.n})` : "—"))].join("\t"),
    );
}

/** Measure actual coordinate errors, rather than treating vendor labels as
 * evidence of precision. Non-storable responses stay in request memory only;
 * this command prints aggregate errors and never writes provider coordinates. */
async function geocodeBench(providerId: string | undefined, perState: number, budget: number, states?: string[]) {
  if (!Number.isSafeInteger(perState) || perState < 1 || !Number.isSafeInteger(budget) || budget < 0)
    throw new Error("Geocoding benchmark requires positive --per-state and nonnegative integer --budget");
  const { geocoderProviders } = await import("../src/geocoding/registry.js");
  const { createLocator } = await import("../src/geocoding/locator.js");
  const { EDGE_METRES, metresBetween } = await import("../src/geocoding/types.js");
  const providers = geocoderProviders().filter(p => !providerId || p.id === providerId);
  if (!providers.length) throw new Error("No requested geocoder is enabled");
  const cases = sample(loadCases().filter(c => Number.isFinite(c.lon) && Number.isFinite(c.lat)), perState, states);
  if (!cases.length) throw new Error("Geocoding benchmark needs cases with known lon and lat");
  const rows: { provider: string; accuracy: string; n: number; p95: number; margin: number; overMargin: number }[] = [];
  for (const provider of providers) {
    const distances = new Map<string, number[]>();
    let attempted = 0, placed = 0;
    for (const c of cases.slice(0, budget)) {
      attempted++;
      const point = await createLocator(c, { providers: [provider], checkSingle: async () => true })();
      if (!point) continue;
      placed++;
      const errors = distances.get(point.accuracy) ?? [];
      errors.push(metresBetween(point, { ...point, lon: c.lon!, lat: c.lat! }));
      distances.set(point.accuracy, errors);
    }
    for (const [accuracy, errors] of distances) {
      errors.sort((a, b) => a - b);
      const margin = EDGE_METRES[accuracy as keyof typeof EDGE_METRES];
      rows.push({ provider: provider.id, accuracy, n: errors.length,
        p95: Math.ceil(errors[Math.ceil(errors.length * 0.95) - 1]), margin,
        overMargin: errors.filter(d => d > margin).length });
    }
    console.log(`${provider.id}: placed ${placed}/${attempted}; quota, rate limits and breakers apply`);
  }
  console.table(rows);
}

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
if (command === "ask") {
  await ask(args[0], {
    budget: Number(flag("--budget") ?? PAID_CALLS_PER_RUN),
    pick: flag("--pick") === "disputed" ? "disputed" : "sample",
    perState: Number(flag("--per-state") ?? 20),
    states: flag("--states")?.split(",").map((s) => s.toUpperCase()),
    ids: flag("--ids")?.split(","),
  });
  const { client } = await import("../src/db/client.js");
  await client.end();
} else if (command === "geocode") {
  try {
    await geocodeBench(flag("--provider"), Number(flag("--per-state") ?? 20), Number(flag("--budget") ?? 100),
      flag("--states")?.split(",").map(s => s.toUpperCase()));
  } finally {
    const { client } = await import("../src/db/client.js");
    await client.end();
  }
} else if (command === "report") report();
else console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
