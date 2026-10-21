/**
 * Louisiana: 5% state plus one combined local rate (parish, school board,
 * city, districts) for each "domicile", from the Remote Sellers Commission's
 * rate lookup, parish by parish for this filing period. A parish's own
 * domicile covers it outside its cities; a city's stands in for its parish's.
 *
 * Economic development, fire, hospital and school districts are domiciles
 * too, but no outline of them is published. A city with one at a different
 * rate is refused with both rates, and so is a parish's unincorporated land
 * when a district named for no city has a different rate. Coverage starts
 * this period.
 */
import https from "node:https";
import tls from "node:tls";
import type { LocalRate } from "./tables.js";
import { stateTable } from "./tables.js";

const LOOKUP = "https://remotesellersfiling.louisiana.gov/lookup/lookup.aspx";
/** The site serves its certificate without GoDaddy's intermediate, so the
 *  intermediate is fetched from GoDaddy and trusted beside the usual roots;
 *  verification stays on. */
const INTERMEDIATE = "https://certs.godaddy.com/repository/gdig2.crt.pem";
const STATE = 0.05;
const PARISHES = 64;
/** A domicile that is a district rather than a parish or a town. */
const DISTRICT = /\bEDDs?\b|\bDist\b|District|Development|School|\bSch\b|Jury|Fire|Hosp|Annexed|Law Enf/i;
/** The lookup's spellings that differ from the Census's. */
const SPELLINGS: Record<string, string> = {
  "Lake Authur": "Lake Arthur",
  Cowley: "Crowley",
  "St. John Parish": "St. John the Baptist Parish",
};

export const louisiana = stateTable("LA", async () => {
  const today = new Date();
  const period = `${String(today.getUTCMonth() + 1).padStart(2, "0")}-01-${today.getUTCFullYear()}`;
  const from = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const domiciles = new Map<string, { name: string; rate: number }>();
  let form = await page();
  for (let n = 1; n <= PARISHES; n++) {
    const parish = `${String(n).padStart(2, "0")}00`;
    form = await page(form, { ddlJurisdiction: parish, ddlFilingPeriod: period, __EVENTTARGET: "ddlJurisdiction" });
    for (const [, name, code, rate] of form.html.matchAll(
      /<td[^>]*>\s*([^<]+?)\s*\((\d{4})\)\s*<\/td>\s*<td[^>]*>\s*([\d.]+)%/g,
    ))
      domiciles.set(code, { name: name.replace(/\s+/g, " ").trim(), rate: Number(rate) / 100 });
  }
  if (domiciles.size < PARISHES) throw new Error(`Louisiana lookup gave only ${domiciles.size} domiciles`);

  const locals: LocalRate[] = [];
  const cities = new Map<string, number>();
  const districts: Array<{ code: string; name: string; rate: number }> = [];
  const parishes = new Map<string, { name: string; rate: number }>();
  const parishOfCode = new Map(
    [...domiciles]
      .filter(([code, d]) => code.endsWith("00") && /Parish$/.test(d.name))
      .map(([code, d]) => [code.slice(0, 2), SPELLINGS[d.name] ?? d.name]),
  );
  const townsInParish: Array<{ name: string; rate: number; parish: string; code: string }> = [];
  for (const [code, { name, rate }] of domiciles) {
    if (code.endsWith("00") && /Parish$/.test(name)) {
      const parish = SPELLINGS[name] ?? name;
      parishes.set(code.slice(0, 2), { name: parish, rate });
      locals.push({ name: parish, rate, from, type: "rc" });
    } else if (DISTRICT.test(name)) districts.push({ code, name, rate });
    else {
      const m = /^(?:(?:City|Town|Village) of )?(.+?)(?: (?:in|within) (.+ Parish)| ([A-Za-z.]+(?: [A-Za-z.]+)? Parish)| (ONLY))?(?: outside EDDs?| Incorporated Area Only| Corporate Limits Only)?$/i.exec(
        name.replace(/ city limits\b/i, ""),
      );
      if (!m) continue;
      const known = SPELLINGS[m[1]] ?? m[1];
      // A town's rate qualified by a parish ("in Lafayette Parish", or a
      // domicile filed under another parish's code) applies in that parish.
      const qualified = m[2] ?? m[3] ?? (m[4] ? parishOfCode.get(code.slice(0, 2)) : undefined);
      if (qualified) {
        townsInParish.push({ name: known, rate, parish: SPELLINGS[qualified] ?? qualified, code });
        continue;
      }
      cities.set(known, rate);
      locals.push({ name: known, rate, from, type: "01x" });
    }
  }
  for (const t of townsInParish) {
    if (!cities.has(t.name)) {
      cities.set(t.name, t.rate);
      locals.push({ name: t.name, rate: t.rate, from, type: "01x" });
    } else if (cities.get(t.name) !== t.rate)
      locals.push({ name: t.name, rate: t.rate, from, type: "01x", inCounty: t.parish });
  }
  for (const d of districts) {
    const city = [...cities.keys()].find((c) =>
      new RegExp(`\\b${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(d.name),
    );
    if (city) {
      if (d.rate !== cities.get(city)) locals.push({ name: city, rate: d.rate, from, type: "maybe" });
      continue;
    }
    const parish = parishes.get(d.code.slice(0, 2));
    if (parish && d.rate !== parish.rate) locals.push({ name: parish.name, rate: d.rate, from, type: "maybe" });
  }
  return {
    stateRates: [{ rate: STATE, from }],
    locals: dedupe(locals),
    source: `LA Remote Sellers Commission rates for ${period}`,
    skipUnmatchedCities: true,
  };
});

/** The highest district rate per city, and each city once. */
function dedupe(locals: LocalRate[]) {
  const by = new Map<string, LocalRate>();
  for (const l of locals) {
    const key = `${l.type}|${l.name}|${l.inCounty ?? ""}`;
    const known = by.get(key);
    if (!known || l.rate > known.rate) by.set(key, l);
  }
  return [...by.values()];
}

interface Form {
  html: string;
  cookie: string;
}

/** The lookup page, after posting `fields` back with its form state. */
async function page(previous?: Form, fields: Record<string, string> = {}): Promise<Form> {
  const hidden = (name: string) =>
    new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(previous?.html ?? "")?.[1] ?? "";
  const body = previous
    ? new URLSearchParams({
        __VIEWSTATE: hidden("__VIEWSTATE"),
        __VIEWSTATEGENERATOR: hidden("__VIEWSTATEGENERATOR"),
        __EVENTVALIDATION: hidden("__EVENTVALIDATION"),
        __EVENTARGUMENT: "",
        ddlStateSelect: "LA",
        ddlAuthority: "1000",
        ddlReturn: "1000",
        ...fields,
      }).toString()
    : undefined;
  const ca = [...tls.rootCertificates, await intermediate()];
  return new Promise((resolve, reject) => {
    const request = https.request(
      LOOKUP,
      {
        method: previous ? "POST" : "GET",
        ca,
        timeout: 60_000,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; opentaxrate data loader)",
          ...(previous
            ? { "Content-Type": "application/x-www-form-urlencoded", Cookie: previous.cookie, "Content-Length": Buffer.byteLength(body!) }
            : {}),
        },
      },
      (response) => {
        let html = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (html += chunk));
        response.on("end", () => {
          if ((response.statusCode ?? 500) >= 400)
            return reject(new Error(`Louisiana lookup answered ${response.statusCode}`));
          const cookie = (response.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).join("; ");
          resolve({ html, cookie: cookie || previous?.cookie || "" });
        });
      },
    );
    request.on("timeout", () => request.destroy(new Error("Louisiana lookup timed out")));
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

let intermediatePem: Promise<string> | null = null;
function intermediate() {
  intermediatePem ??= fetch(INTERMEDIATE).then((r) => {
    if (!r.ok) throw new Error(`${INTERMEDIATE} answered ${r.status}`);
    return r.text();
  });
  return intermediatePem;
}
