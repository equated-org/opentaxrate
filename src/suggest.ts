/**
 * Address suggestions as the visitor types, relayed to a Photon geocoder
 * (OPENTAXRATE_PHOTON_URL, e.g. http://spark-3:2322 over a private network),
 * so the Photon itself never has to be public. The answer is Photon's own
 * GeoJSON, unchanged. Off unless the URL is set.
 *
 *   GET /v1/suggest?q=&limit=&lang=&bbox=&layer=&layer=
 */
import type { Handler } from "hono";
import { z } from "zod";

const LAYERS = ["house", "street", "locality", "district", "city", "county", "state"] as const;
const TIMEOUT_MS = 5_000;

const query = z.object({
  q: z.string().trim().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(10).default(5),
  lang: z.enum(["en", "de", "fr", "default"]).default("en"),
  bbox: z.string().regex(/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/).optional(),
});

export function suggestFromEnv(env: NodeJS.ProcessEnv = process.env): Handler | undefined {
  const base = env.OPENTAXRATE_PHOTON_URL?.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  return async (c) => {
    const parsed = query.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "Give q, the text typed so far.", code: "BAD_REQUEST" }, 400);
    const layers = (c.req.queries("layer") ?? []).filter((l): l is (typeof LAYERS)[number] => (LAYERS as readonly string[]).includes(l));
    const params = new URLSearchParams({ q: parsed.data.q, limit: String(parsed.data.limit), lang: parsed.data.lang });
    if (parsed.data.bbox) params.set("bbox", parsed.data.bbox);
    for (const l of layers) params.append("layer", l);
    try {
      const response = await fetch(`${base}/api?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return c.json({ error: "The suggestion service failed.", code: "UPSTREAM_UNAVAILABLE" }, 502);
      c.header("Cache-Control", "public, max-age=300");
      return c.json(await response.json());
    } catch {
      return c.json({ error: "The suggestion service didn't answer.", code: "UPSTREAM_TIMEOUT" }, 504);
    }
  };
}
