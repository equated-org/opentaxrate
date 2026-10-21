/**
 * County, city and town outlines from the Census Bureau's TIGER/Line files,
 * read from their shapefiles, for loading into PostGIS (shapes.ts answers the
 * lookups' questions of them). `contains` stays for testing points against
 * outlines still in memory, before any are loaded.
 *
 * States tax by different units: most by city (a Census place), some by town
 * or township (a Census county subdivision, as in Wisconsin and Vermont).
 * Both are kept under their FIPS codes, which the states' files reuse.
 * Coordinates are NAD83 degrees, within a metre or two of a geocoder's WGS84.
 */
import { unzipSync } from "fflate";

/** Every state with a sales tax question to answer, and DC, by FIPS code. */
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09",
  DE: "10", DC: "11", FL: "12", GA: "13", HI: "15", ID: "16", IL: "17",
  IN: "18", IA: "19", KS: "20", KY: "21", LA: "22", ME: "23", MD: "24",
  MA: "25", MI: "26", MN: "27", MS: "28", MO: "29", MT: "30", NE: "31",
  NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36", NC: "37", ND: "38",
  OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45", SD: "46",
  TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56",
};

export interface Shape {
  kind: "county" | "place" | "cousub";
  /** State FIPS. */
  stateFips: string;
  /** County FIPS (three digits), or place or county subdivision FIPS (five). */
  fips: string;
  name: string;
  /** Outer rings and holes alike; a point inside an odd number is inside. */
  rings: Array<Array<[number, number]>>;
  bbox: [number, number, number, number];
}

export interface Point {
  lon: number;
  lat: number;
}

/** The shapes in a TIGER county, place or county subdivision zip, for the
 *  states in `stateFips`. */
export function readTigerZip(
  zip: Uint8Array,
  kind: Shape["kind"],
  stateFips: Set<string>,
): Shape[] {
  const files = unzipSync(zip, { filter: (f) => /\.(shp|dbf)$/i.test(f.name) });
  const shp = Object.entries(files).find(([n]) => /\.shp$/i.test(n))?.[1];
  const dbf = Object.entries(files).find(([n]) => /\.dbf$/i.test(n))?.[1];
  if (!shp || !dbf) throw new Error("The TIGER zip has no shapefile");
  const records = readDbf(dbf);
  const polygons = readPolygons(shp);
  // A town in two counties is one record per county; it becomes one shape.
  const shapes = new Map<string, Shape>();
  records.forEach((r, i) => {
    if (!stateFips.has(r.STATEFP)) return;
    const fips = { county: r.COUNTYFP, place: r.PLACEFP, cousub: r.COUSUBFP }[kind];
    const rings = polygons[i];
    if (!rings?.length || !fips || /^0+$/.test(fips)) return;
    const key = `${r.STATEFP}:${fips}`;
    const known = shapes.get(key);
    if (known) {
      known.rings.push(...rings);
      known.bbox = bboxOf(known.rings);
    } else
      shapes.set(key, {
        kind,
        stateFips: r.STATEFP,
        fips,
        name: r.NAME,
        rings,
        bbox: bboxOf(rings),
      });
  });
  return [...shapes.values()];
}

export function contains(shape: Pick<Shape, "rings">, p: Point) {
  let inside = false;
  for (const ring of shape.rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > p.lat !== yj > p.lat &&
        p.lon < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi
      )
        inside = !inside;
    }
  return inside;
}

function bboxOf(rings: Shape["rings"]): Shape["bbox"] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of rings)
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return [minX, minY, maxX, maxY];
}

/** Each record's polygon rings, in file order; null for a null shape. */
function readPolygons(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const polygons: Array<Shape["rings"] | null> = [];
  let at = 100;
  while (at + 8 <= buffer.byteLength) {
    const length = view.getInt32(at + 4, false) * 2;
    const content = at + 8;
    const type = view.getInt32(content, true);
    if (type === 5) {
      const parts = view.getInt32(content + 36, true);
      const points = view.getInt32(content + 40, true);
      const starts = Array.from({ length: parts }, (_, i) =>
        view.getInt32(content + 44 + i * 4, true),
      );
      const first = content + 44 + parts * 4;
      const rings: Shape["rings"] = starts.map((start, i) => {
        const end = i + 1 < parts ? starts[i + 1] : points;
        const ring: Array<[number, number]> = [];
        for (let k = start; k < end; k++)
          ring.push([
            round(view.getFloat64(first + k * 16, true)),
            round(view.getFloat64(first + k * 16 + 8, true)),
          ]);
        return ring;
      });
      polygons.push(rings);
    } else polygons.push(null);
    at = content + length;
  }
  return polygons;
}

function readDbf(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const count = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);
  const decoder = new TextDecoder("utf-8");
  const fields: Array<{ name: string; offset: number; length: number }> = [];
  let offset = 1;
  for (let at = 32; buffer[at] !== 0x0d && at < headerLength; at += 32) {
    const name = decoder.decode(buffer.subarray(at, at + 11)).replace(/\0.*$/, "");
    const length = buffer[at + 16];
    fields.push({ name, offset, length });
    offset += length;
  }
  const records: Array<Record<string, string>> = [];
  for (let i = 0; i < count; i++) {
    const start = headerLength + i * recordLength;
    const record: Record<string, string> = {};
    for (const f of fields)
      record[f.name] = decoder
        .decode(buffer.subarray(start + f.offset, start + f.offset + f.length))
        .trim();
    records.push(record);
  }
  return records;
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
