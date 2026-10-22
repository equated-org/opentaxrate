/**
 * The streets in each ZIP of a map-read state, from the Census Bureau's TIGER
 * address features: every named street segment, with the ZIP on its left and
 * right. Only each county file's attribute table is read. The geocoder
 * matcher uses them to tell a typed street that's one letter off a real one
 * from a different real street (see geocoding/providers/match.ts).
 */
import { unzipSync } from "fflate";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { zipStreetNames } from "../db/schema.js";
import { parseStreet } from "../address.js";
import { latestTigerAddressFiles } from "./downloads.js";
import { readDbf } from "./tiger.js";
import { STATE_FIPS } from "../coverage.js";

/** County files read at once. */
const PARALLEL = 6;
const BATCH = 5_000;

export async function loadStreetNames(state: string, dir?: string, log: (line: string) => void = console.log) {
  const { year, files } = await latestTigerAddressFiles(STATE_FIPS[state], dir);
  if (!files.length) throw new Error(`No TIGER address features for ${state} in ${year}`);
  const file = `tl_${year}_${STATE_FIPS[state]}_addrfeat`;
  const streets = new Map<string, { zip5: string; streetKey: string; street: string }>();
  let next = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < files.length) {
      const f = files[next++];
      const zip = unzipSync(await f.bytes(), { filter: (e) => /\.dbf$/i.test(e.name) });
      const dbf = Object.values(zip)[0];
      if (!dbf) throw new Error(`${f.name} has no attribute table`);
      for (const r of readDbf(dbf)) {
        const key = r.FULLNAME && parseStreet(`1 ${r.FULLNAME}`)?.streetKey;
        if (!key) continue;
        for (const zip5 of new Set([r.ZIPL, r.ZIPR]))
          if (/^\d{5}$/.test(zip5 ?? "")) streets.set(`${zip5}|${key}`, { zip5, streetKey: key, street: r.FULLNAME });
      }
    }
  }));
  const rows = [...streets.values()].map((s) => ({ state, ...s, file }));
  await db.transaction(async (tx) => {
    await tx.delete(zipStreetNames).where(eq(zipStreetNames.state, state));
    for (let i = 0; i < rows.length; i += BATCH) await tx.insert(zipStreetNames).values(rows.slice(i, i + BATCH));
  });
  log(`${state}: ${rows.length} streets in ZIPs from ${files.length} ${file} county files`);
  return rows.length;
}
