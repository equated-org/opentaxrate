/**
 * Readers for the formats states publish their rates and outlines in:
 *   - a spreadsheet (.xlsx), as rows of cell text, sheet by sheet;
 *   - an ArcGIS feature layer, as every feature's attributes and polygon
 *     rings in longitude and latitude, page by page;
 *   - any file, from a local copy in `dir` when one is there, else the web.
 * The xlsx reader handles the plain sheets tax offices publish (shared and
 * inline strings, numbers), not formulas' cached results beyond their value.
 */
import fs from "node:fs";
import path from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { Shape } from "../tiger.js";
import { archiveResponse, downloadedBytes, keepLocalCopy, savedBytes } from "../archive.js";

const USER_AGENT =
  process.env.OPENTAXRATE_USER_AGENT ||
  "Mozilla/5.0 (compatible; opentaxrate data loader; +https://github.com/opentaxrate/opentaxrate)";

/** A published file's bytes, from `dir` when it holds a file of that name. */
export async function fetchFile(url: string, dir?: string, name?: string) {
  const fileName = name ?? decodeURIComponent(new URL(url).pathname.split("/").pop()!);
  if (dir) {
    const local = path.join(dir, fileName);
    if (fs.existsSync(local)) {
      await keepLocalCopy(url, local, fileName);
      return new Uint8Array(fs.readFileSync(local));
    }
  }
  const saved = savedBytes(url, fileName);
  if (saved) return saved;
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return downloadedBytes(url, response, fileName);
}

export async function fetchText(url: string, dir?: string, name?: string) {
  return strFromU8(await fetchFile(url, dir, name));
}

/** Each sheet's rows as arrays of cell text, by sheet name. */
export function readXlsx(bytes: Uint8Array): Map<string, string[][]> {
  const files = unzipSync(bytes);
  const text = (name: string) => (files[name] ? strFromU8(files[name]) : "");
  const shared = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    (m) => decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")),
  );
  const rels = new Map(
    [...text("xl/_rels/workbook.xml.rels").matchAll(/<Relationship [^>]*>/g)].map((m) => [
      /Id="([^"]+)"/.exec(m[0])![1],
      /Target="([^"]+)"/.exec(m[0])![1].replace(/^\/?(xl\/)?/, "xl/"),
    ]),
  );
  const sheets = new Map<string, string[][]>();
  for (const m of text("xl/workbook.xml").matchAll(/<sheet [^>]*>/g)) {
    const name = decodeXml(/name="([^"]+)"/.exec(m[0])![1]);
    const target = rels.get(/r:id="([^"]+)"/.exec(m[0])![1]);
    if (!target) continue;
    const rows: string[][] = [];
    for (const row of text(target).matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+)\d+"/.exec(c[1])?.[1];
        const type = /t="([^"]+)"/.exec(c[1])?.[1];
        const body = c[2] ?? "";
        const value = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        const inline = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("");
        const cell =
          type === "s" ? shared[Number(value)] ?? "" : type === "inlineStr" ? decodeXml(inline) : decodeXml(value ?? "");
        cells[ref ? columnIndex(ref) : cells.length] = cell;
      }
      rows.push(Array.from(cells, (v) => v ?? ""));
    }
    sheets.set(name, rows);
  }
  return sheets;
}

export interface Feature {
  attributes: Record<string, unknown>;
  rings: Shape["rings"];
}

/** Every feature of an ArcGIS layer matching `where`, with rings in WGS84. */
export async function fetchLayer(
  layerUrl: string,
  { where = "1=1", outFields = "*", pageSize = 1000 } = {},
): Promise<Feature[]> {
  const features: Feature[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${layerUrl}/query`);
    url.search = new URLSearchParams({
      where,
      outFields,
      outSR: "4326",
      f: "geojson",
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      geometryPrecision: "6",
    }).toString();
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`${layerUrl} answered ${response.status}`);
    const text = await response.text();
    await archiveResponse({ url: url.toString() }, text, `${layerName(layerUrl)}-${offset}.geojson`);
    const body = JSON.parse(text) as {
      features?: Array<{ properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }>;
      exceededTransferLimit?: boolean;
      properties?: { exceededTransferLimit?: boolean };
      error?: { message: string };
    };
    if (body.error) throw new Error(`${layerUrl}: ${body.error.message}`);
    for (const f of body.features ?? []) {
      const rings = ringsOf(f.geometry);
      if (rings.length) features.push({ attributes: f.properties, rings });
    }
    const more = body.exceededTransferLimit ?? body.properties?.exceededTransferLimit;
    if (!more && (body.features?.length ?? 0) < pageSize) break;
    if (!body.features?.length) break;
  }
  return features;
}

/** "Sales_Tax_Boundaries-2" for ".../Sales_Tax_Boundaries/FeatureServer/2". */
const layerName = (layerUrl: string) =>
  new URL(layerUrl).pathname
    .split("/")
    .filter((p) => p && !/^(arcgis|rest|services|FeatureServer|MapServer)$/i.test(p))
    .slice(-2)
    .join("-") || "layer";

/** A GeoJSON polygon's or multipolygon's rings, holes included. */
export function ringsOf(geometry: { type: string; coordinates: unknown } | null): Shape["rings"] {
  if (!geometry) return [];
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const ring = (r: number[][]) => r.map(([x, y]) => [round(x), round(y)] as [number, number]);
  if (geometry.type === "Polygon") return (geometry.coordinates as number[][][]).map(ring);
  if (geometry.type === "MultiPolygon")
    return (geometry.coordinates as number[][][][]).flatMap((p) => p.map(ring));
  return [];
}

export function bboxOf(rings: Shape["rings"]): Shape["bbox"] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings)
    for (const [x, y] of r) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return [minX, minY, maxX, maxY];
}

/** "2026-10-01" from a JS Date, epoch milliseconds, "10/01/2026" or "20261001". */
export function isoDay(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return new Date(value).toISOString().slice(0, 10);
  const s = String(value).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** The day `days` after (or before) an ISO day. */
export function shiftDay(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** An Excel serial day number as "YYYY-MM-DD". */
export const excelDay = (serial: number) =>
  new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10);

function columnIndex(letters: string) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, "&");
}
