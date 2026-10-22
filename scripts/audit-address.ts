/**
 * Address-reading audit: real addresses from the National Address Database,
 * which files each one already split into its parts, read by parseStreet and
 * checked two ways.
 *   1. Parts: the house number, directions and street type parseStreet reads
 *      from the address as filed must be NAD's.
 *   2. Typings: the same address as people type it (type abbreviated, spelled
 *      out or left off; directions spelled out; a unit after it; lower case;
 *      periods) must still be the same street, by its key or an alternate,
 *      and must still pass the geocoder matcher against the address as filed.
 * Every failure is a reading rule missing; the report groups them by kind.
 *
 *   npx tsx scripts/audit-address.ts <nad.jsonl> [report.md]
 *
 * The sample comes from NAD's public feature service, by scripts/nad-parts.py
 * (python3 -I scripts/nad-parts.py <probe.json> <nad.jsonl>); a run makes no
 * network calls. On 9,200 addresses from 46 states, 49 of 57,262 typings
 * fail, all rare forms: a street named North ("211 East North"), a word after
 * the type ("Forest Avenue Extension"), a letter before the number ("E 30
 * Enfield Terrace"), "454.5 Avenue A", and NAD's own junk ("3712 APT West
 * Broadway").
 */
import fs from "node:fs";
import { parseStreet, type StreetParts } from "../src/address.js";
import { matchesAddress } from "../src/geocoding/providers/match.js";

interface Nad {
  State: string;
  AddNo_Full?: string | null;
  St_PreDir?: string | null;
  St_PreTyp?: string | null;
  St_PreMod?: string | null;
  St_Name?: string | null;
  St_PosTyp?: string | null;
  St_PosDir?: string | null;
  St_PosMod?: string | null;
  StNam_Full?: string | null;
  Post_City?: string | null;
  Zip_Code?: string | number | null;
}

const [file, reportFile] = process.argv.slice(2);
if (!file) throw new Error("usage: audit-address.ts <nad.jsonl> [report.md]");
const rows: Nad[] = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const clean = (v: unknown) => {
  const s = String(v ?? "").trim();
  return /^(|NOT STATED|UNKNOWN|NULL|NONE)$/i.test(s) ? "" : s.replace(/\s+/g, " ");
};
const DIRECTIONS: Record<string, string> = {
  NORTH: "N", SOUTH: "S", EAST: "E", WEST: "W", NORTHEAST: "NE", NORTHWEST: "NW", SOUTHEAST: "SE", SOUTHWEST: "SW",
};
const direction = (s: string) => {
  const u = s.toUpperCase().replace(/\./g, "");
  return DIRECTIONS[u] ?? u;
};
/** A street type's abbreviation as parseStreet writes it, read in a minimal line. */
const typeOf = (type: string) => parseStreet(`1 X ${type}`)?.suffix ?? "?";
const spelled = (abbr: string) => Object.entries(DIRECTIONS).find(([, a]) => a === abbr)?.[0] ?? abbr;

const ORDINALS = ["", "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH", "SIXTH", "SEVENTH", "EIGHTH", "NINTH", "TENTH", "ELEVENTH", "TWELFTH",
  "THIRTEENTH", "FOURTEENTH", "FIFTEENTH", "SIXTEENTH", "SEVENTEENTH", "EIGHTEENTH", "NINETEENTH", "TWENTIETH"];
const NUMBERED = ORDINALS.map((_, n) => `${n}${n % 10 === 1 && n !== 11 ? "ST" : n % 10 === 2 && n !== 12 ? "ND" : n % 10 === 3 && n !== 13 ? "RD" : "TH"}`);

const failures = new Map<string, string[]>();
const fail = (kind: string, example: string) => {
  const list = failures.get(kind) ?? [];
  list.push(example);
  failures.set(kind, list);
};
const sameStreet = (a: StreetParts, b: StreetParts) =>
  [a.streetKey, ...(a.alternates ?? []).map((x) => x.streetKey)].some((k) =>
    [b.streetKey, ...(b.alternates ?? []).map((x) => x.streetKey)].includes(k));

let audited = 0;
let typingsTried = 0;
for (const r of rows) {
  const house = clean(r.AddNo_Full);
  const street = clean(r.StNam_Full);
  if (!house || !street || !/\d/.test(house)) continue;
  audited++;
  const line = `${house} ${street}`;
  const filed = parseStreet(line);
  if (!filed) {
    fail("not read at all", line);
    continue;
  }

  // 1. Parts.
  const pre = clean(r.St_PreDir);
  const post = clean(r.St_PosDir);
  const type = clean(r.St_PosTyp);
  // A number NAD writes in parts ("2660 1/2", "10S 231", "103 13") is read
  // by its first, which is what a range is looked up by.
  const leading = house.toUpperCase().split(" ")[0];
  if (filed.houseText.toUpperCase() !== (house.includes(" ") ? leading : house.toUpperCase())) fail("house number", `${line} → ${filed.houseText}`);
  // NAD often files a direction inside the name ("E MAIN ST" with no
  // direction): reading it as one is right, so only a direction NAD files
  // apart, read otherwise, or one read from nowhere in the line, counts.
  const name = clean(r.St_Name).toUpperCase();
  const fromName = (d: string) => !!d && name.split(" ").some((w) => direction(w) === d);
  if (filed.preDirectional !== (pre ? direction(pre) : "") && !(!pre && fromName(filed.preDirectional)))
    fail("leading direction", `${line} → "${filed.preDirectional}", NAD "${pre}"`);
  if (filed.postDirectional !== (post ? direction(post) : "") && !(!post && fromName(filed.postDirectional)))
    fail("trailing direction", `${line} → "${filed.postDirectional}", NAD "${post}"`);
  const known = (t: string) => !["", "?"].includes(typeOf(t));
  if (type && known(type) && !clean(r.St_PosMod) && filed.suffix !== typeOf(type)) fail("street type", `${line} → "${filed.suffix}", NAD "${type}"`);

  // 2. Typings.
  const city = clean(r.Post_City);
  const zip = String(r.Zip_Code ?? "").padStart(5, "0").slice(0, 5);
  const geocoderFound = { house, street, city, state: r.State, zip, country: "US" };
  const typings: Array<[string, string]> = [];
  const words = street.split(" ");
  if (type && known(type)) {
    let last = -1;
    for (let i = words.length - 1; i > 0 && last < 0; i--) if (words[i].toUpperCase() === type.toUpperCase()) last = i;
    if (last >= 0) {
      const abbr = typeOf(type);
      const spelledType = type.length > abbr.length ? type : null;
      typings.push(["type abbreviated", [house, ...words.slice(0, last), abbr, ...words.slice(last + 1)].join(" ")]);
      if (spelledType) typings.push(["type spelled out", [house, ...words.slice(0, last), spelledType, ...words.slice(last + 1)].join(" ")]);
      typings.push(["type left off", [house, ...words.slice(0, last), ...words.slice(last + 1)].join(" ")]);
    }
  }
  if (pre) typings.push(["leading direction spelled out", line.replace(new RegExp(`^(${house}) ${pre}\\b`, "i"), `$1 ${spelled(direction(pre))}`)]);
  if (post) typings.push(["trailing direction spelled out", line.replace(new RegExp(`\\b${post}$`, "i"), spelled(direction(post)))]);
  typings.push(["unit after (Apt)", `${line} Apt 4`], ["unit after (#)", `${line} #4`], ["unit after (Unit B)", `${line} Unit B`]);
  typings.push(["lower case", line.toLowerCase()], ["periods", line.replace(/\b(N|S|E|W|ST|AVE|RD|DR|LN|BLVD|CT)\b/gi, "$1.")]);
  typings.push(["unit before (Apt 4, ...)", `Apt 4, ${line}`], ["city, state and ZIP after", `${line}, ${city || "Town"}, ${r.State} ${zip}`]);
  // Numbered streets spelled out and back ("5th" ↔ "Fifth"), and Saint,
  // Mount and Fort as people write them.
  const ordinal = /\b(\d{1,2})(ST|ND|RD|TH)\b/i.exec(street);
  if (ordinal && ORDINALS[Number(ordinal[1])]) typings.push(["numbered street spelled out", line.replace(ordinal[0], ORDINALS[Number(ordinal[1])])]);
  const spelledOrdinal = new RegExp(`\\b(${ORDINALS.filter(Boolean).join("|")})\\b`, "i").exec(street);
  if (spelledOrdinal) typings.push(["spelled-out street as a number", line.replace(spelledOrdinal[0], NUMBERED[ORDINALS.indexOf(spelledOrdinal[0].toUpperCase())])]);
  for (const [long, short] of [["SAINT", "ST"], ["MOUNT", "MT"], ["FORT", "FT"]] as const) {
    if (new RegExp(`\\b${long}\\b`, "i").test(street)) typings.push([`${long.toLowerCase()} abbreviated`, line.replace(new RegExp(`\\b${long}\\b`, "i"), short)]);
    // Only where it starts the name ("St Charles Ave"), not a type ("6th St S").
    if (new RegExp(`^${short}\\.? [A-Z]`, "i").test(name))
      typings.push([`${short.toLowerCase()} spelled out`, line.replace(new RegExp(`\\b${short}\\.?(?= [A-Z])`, "i"), long)]);
  }
  // Highways and county roads, the ways they're written.
  const highway = /\b(?:STATE (?:HIGHWAY|HWY|ROUTE|RTE)|STATE ROAD|SR|HIGHWAY|HWY|ROUTE|RTE|US HIGHWAY|US HWY|US ROUTE|US)\s+(\d+[A-Z]?)$/i.exec(street);
  if (highway && !/\b(COUNTY|UNITED STATES|US)\s*$/i.test(street.slice(0, highway.index))) for (const form of ["HWY", "HIGHWAY", "STATE HIGHWAY", "STATE ROUTE", "SR", r.State])
    typings.push([`highway as "${form} n"`, `${house} ${street.slice(0, highway.index)}${form} ${highway[1]}`.replace(/\s+/g, " ")]);
  const county = /\b(?:COUNTY ROAD|COUNTY RD|CO RD|CR)\s+(\S+)$/i.exec(street);
  if (county) for (const form of ["COUNTY ROAD", "COUNTY RD", "CO RD", "CR"])
    typings.push([`county road as "${form} n"`, `${house} ${street.slice(0, county.index)}${form} ${county[1]}`.replace(/\s+/g, " ")]);
  // One letter wrong in a name of six letters or more: geocoders read past
  // it; the matcher is strict, so this measures what it costs.
  const long = name.split(" ").find((w) => w.length >= 6 && /^[A-Z]+$/.test(w));
  if (long) {
    const i = Math.floor(long.length / 2);
    const typo = long.slice(0, i) + (long[i] === "E" ? "A" : "E") + long.slice(i + 1);
    typings.push(["one-letter typo in the name", line.replace(new RegExp(`\\b${long}\\b`, "i"), typo)]);
  }

  for (const [kind, typed] of typings) {
    if (typed === line && kind !== "lower case") continue;
    typingsTried++;
    const p = parseStreet(typed);
    if (!p) {
      fail(`typing not read: ${kind}`, typed);
      continue;
    }
    if (!sameStreet(p, filed) || p.houseText.toUpperCase() !== filed.houseText.toUpperCase())
      fail(`typing read as another street: ${kind}`, `${typed} → ${p.streetKey}, filed ${filed.streetKey}`);
    if (!matchesAddress({ street: typed, city, state: r.State, zip }, geocoderFound))
      fail(`typing fails the geocoder match: ${kind}`, `${typed} vs found "${line}"`);
  }
}

const sorted = [...failures].sort((a, b) => b[1].length - a[1].length);
const total = sorted.reduce((n, [, l]) => n + l.length, 0);
const report = [
  `# Address-reading audit`,
  "",
  `${audited} NAD addresses from ${new Set(rows.map((r) => r.State)).size} states; ${typingsTried} typings of them. ${total} failures in ${sorted.length} kinds.`,
  "",
  "| Kind | Count |",
  "|---|---|",
  ...sorted.map(([k, l]) => `| ${k} | ${l.length} |`),
  "",
  ...sorted.flatMap(([k, l]) => [`## ${k} (${l.length})`, "", ...l.slice(0, 12).map((e) => `- ${e}`), ""]),
].join("\n");
if (reportFile) fs.writeFileSync(reportFile, report);
console.log(report.split("\n").slice(0, 8 + sorted.length).join("\n"));
