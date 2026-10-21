/**
 * One rate lookup as the API and the CLI ask it: the address placed on the
 * map (by every configured geocoder together) only when the engine needs it.
 * Given a trace, the engine records how it placed the address, and the
 * outlines it tested are drawn near the point for display.
 */
import { addressRates, type AddressRate, type Trace } from "./rates/index.js";
import { outlineGeometry } from "./rates/shapes.js";
import { locateAddress } from "./geocoding/index.js";
import { addressStandardizer } from "./standardize/index.js";
import { mapboxGeocoder } from "./geocoding/mapbox.js";

export interface RateQuery {
  state: string;
  street: string;
  city: string;
  zip?: string;
  /** YYYY-MM-DD; today when absent. */
  date?: string;
}

/** How far around the point a traced outline is drawn. */
const TRACE_CLIP_METRES = 3_000;

export async function lookUpRate(q: RateQuery, options: { trace?: Trace } = {}): Promise<AddressRate> {
  const { trace } = options;
  const state = q.state.toUpperCase();
  const date = q.date ?? new Date().toISOString().slice(0, 10);
  const primary = mapboxGeocoder();
  const standardizer = addressStandardizer();
  const found = addressRates.at(
    {
      state,
      street: q.street,
      city: q.city,
      zip: q.zip,
      locate: () => locateAddress({ street: q.street, city: q.city, state, zip: q.zip }, primary, trace),
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
    const shapes = await outlineGeometry(state, trace.outlines, trace.point, TRACE_CLIP_METRES);
    for (const o of trace.outlines) {
      const geometry = shapes.get(`${o.kind}:${o.fips}`);
      if (geometry) o.geometry = geometry;
    }
  } catch (error) {
    console.error(error);
  }
}
