/**
 * One rate lookup as the API and the CLI ask it: the address placed on the
 * map by a staged locator only when the engine needs it. Given a trace, the
 * engine records how it placed the address, and the outlines it tested are
 * drawn near the point for display.
 */
import { addressRates, type AddressRate, type Trace } from "./rates/index.js";
import { outlineGeometry } from "./rates/shapes.js";
import { createLocator } from "./geocoding/index.js";
import { addressStandardizer } from "./standardize/index.js";

export interface RateQuery {
  state: string;
  street: string;
  city: string;
  zip?: string;
  /** YYYY-MM-DD; today when absent. */
  date?: string;
}

/** How far around the point a traced outline is drawn: at least 3 km, and
 *  far enough to include the nearest edge of an outline that levies, so the
 *  line that settled the rate is on the map, up to 20 km. */
const TRACE_CLIP_METRES = { min: 3_000, max: 20_000 };

export async function lookUpRate(q: RateQuery, options: { trace?: Trace } = {}): Promise<AddressRate> {
  const { trace } = options;
  const state = q.state.toUpperCase();
  const date = q.date ?? new Date().toISOString().slice(0, 10);
  const locate = createLocator({ street: q.street, city: q.city, state, zip: q.zip }, { trace });
  const standardizer = addressStandardizer();
  const found = addressRates.at(
    {
      state,
      street: q.street,
      city: q.city,
      zip: q.zip,
      locate,
      standardize: standardizer && (() => standardizer({ street: q.street, city: q.city, state, zip: q.zip })),
      trace,
    },
    date,
  );
  if (!trace) return found;
  try {
    return await found;
  } finally {
    await drawOutlines(state, trace);
  }
}

/** Adds each traced outline's shape near the point. A failure here only
 *  leaves the shapes out; it never changes the answer. */
async function drawOutlines(state: string, trace: Trace) {
  if (!trace.point || !trace.outlines.length) return;
  try {
    const nearest = Math.min(...trace.outlines.filter((o) => o.levies).map((o) => o.edgeMetres));
    const metres = Math.min(TRACE_CLIP_METRES.max, Math.max(TRACE_CLIP_METRES.min, nearest * 1.25 + 500));
    const shapes = await outlineGeometry(state, trace.outlines, trace.point, metres);
    for (const o of trace.outlines) {
      const geometry = shapes.get(`${o.kind}:${o.fips}`);
      if (geometry) o.geometry = geometry;
    }
  } catch (error) {
    console.error(error);
  }
}
