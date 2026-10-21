/**
 * Accuracy comparison: the same addresses, asked of opentaxrate and of other
 * rate services, judged by each state's official answer.
 *
 *   tsx scripts/bench.ts ask <provider> [--per-state N] [--budget N] [--states TX,WA]
 *   tsx scripts/bench.ts report
 *
 * Cases are the CSVs in artifacts/bench/cases (state,street,city,zip,date,
 * expected,source[,lon,lat,notes]); `expected` is the state's own answer.
 * Every provider samples the same addresses: each state's cases in one fixed
 * shuffled order, the first N of it. Every answer, with the provider's raw
 * response, is appended to artifacts/bench/answers/<provider>.jsonl and never
 * asked again, so a free plan's calls are spent once and kept for later
 * cross-checks. Keys come from the environment (run under `infisical run`);
 * they are never written out.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../artifacts/bench/", import.meta.url).pathname;
const CASES = path.join(ROOT, "cases");
const ANSWERS = path.join(ROOT, "answers");

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
  /** The full pipeline: geocoders, then the engine. */
  opentaxrate: {
    needs: [],
    pauseMs: 0,
    async ask(c) {
      const { lookUpRate } = await import("../src/lookup.js");
      return lookUpRate(c).then(
        (r) => ({ rate: r.rate, raw: { match: r.match, locationCode: r.locationCode } }),
        (e: Error) => ({ refused: e.message }),
      );
    },
  },
  /** The engine alone, at the case's own address point. */
  "opentaxrate-point": {
    needs: [],
    pauseMs: 0,
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
    needs: ["TAXCLOUD_API_KEY", "TAXCLOUD_ACCOUNT_ID"],
    pauseMs: 300,
    async ask(c) {
      const address = { line1: c.street, city: c.city, state: c.state, zip: c.zip, countryCode: "US" };
      const response = await fetch(
        `https://api.v3.taxcloud.com/tax/connections/${env("TAXCLOUD_ACCOUNT_ID")}/carts`,
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
    pauseMs: 300,
    async ask(c) {
      const host = env("AVALARA_SANDBOX") ? "sandbox-rest.avatax.com" : "rest.avatax.com";
      const url = new URL(`https://${host}/api/v2/taxrates/byaddress`);
      url.search = new URLSearchParams({ line1: c.street, city: c.city, region: c.state, postalCode: c.zip, country: "US" }).toString();
      const auth = Buffer.from(`${env("AVALARA_ACCOUNT_ID")}:${env("AVALARA_LICENSE_KEY")}`).toString("base64");
      const response = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      const raw = await json(response);
      return response.ok && typeof raw?.totalRate === "number"
        ? { rate: round(raw.totalRate), raw }
        : { refused: `${response.status} ${raw?.error?.message ?? ""}`, raw };
    },
  },
  taxjar: {
    needs: ["TAXJAR_API_TOKEN"],
    pauseMs: 300,
    async ask(c) {
      const url = new URL(`https://api.taxjar.com/v2/rates/${c.zip.slice(0, 5)}`);
      url.search = new URLSearchParams({ street: c.street, city: c.city, state: c.state, country: "US" }).toString();
      const response = await fetch(url, { headers: { Authorization: `Bearer ${env("TAXJAR_API_TOKEN")}` } });
      const raw = await json(response);
      const rate = Number(raw?.rate?.combined_rate);
      return response.ok && Number.isFinite(rate)
        ? { rate: round(rate), raw }
        : { refused: `${response.status} ${raw?.detail ?? raw?.error ?? ""}`, raw };
    },
  },
  ziptax: {
    needs: ["ZIPTAX_API_KEY"],
    pauseMs: 500,
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

const notAboutAddress = (a: Answer): a is { refused: string } =>
  "refused" in a && /^(error:|40[13] |429 |5\d\d )|isn’t active|not active/i.test(a.refused);

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
      if (!Number.isFinite(c.expected)) continue;
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

async function ask(provider: string, perState: number, budget: number, states?: string[]) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`unknown provider ${provider}; one of ${Object.keys(PROVIDERS).join(", ")}`);
  const missing = p.needs.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`${provider} needs ${missing.join(", ")}`);
  fs.mkdirSync(ANSWERS, { recursive: true });
  const done = loadAnswers(provider);
  const todo = sample(loadCases(), perState, states).filter((c) => !done.has(c.id));
  const out = fs.createWriteStream(path.join(ANSWERS, `${provider}.jsonl`), { flags: "a" });
  let asked = 0;
  for (const c of todo.slice(0, budget)) {
    const answer = await p.ask(c).catch((e: Error) => ({ refused: `error: ${e.message}` }));
    // An account or service failure says nothing about the address: it is
    // reported and asked again next run, and the run stops on the first.
    if (notAboutAddress(answer)) {
      console.log(`${provider}: stopped, ${answer.refused.slice(0, 200)}`);
      break;
    }
    out.write(`${JSON.stringify({ id: c.id, state: c.state, at: new Date().toISOString(), ...answer })}\n`);
    asked++;
    if (asked % 25 === 0) console.log(`${provider}: ${asked}/${Math.min(budget, todo.length)}`);
    if (p.pauseMs) await new Promise((r) => setTimeout(r, p.pauseMs));
  }
  out.end();
  console.log(`${provider}: asked ${asked}, ${todo.length - asked} left in the sample, ${done.size + asked} kept`);
}

/** Per state and provider: of the sampled cases it was asked, the share it
 *  got right, and the share it refused. Right is within 1e-6 of the state's. */
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
        else if (Math.abs(a.rate - c.expected) < 1e-6) cell.right++;
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

const [command, ...args] = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
if (command === "ask") {
  await ask(
    args[0],
    Number(flag("--per-state") ?? 20),
    Number(flag("--budget") ?? Infinity),
    flag("--states")?.split(",").map((s) => s.toUpperCase()),
  );
  const { client } = await import("../src/db/client.js");
  await client.end();
} else if (command === "report") report();
else console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
