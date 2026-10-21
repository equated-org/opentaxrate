/**
 * The lookup routes a state to the map by coverage.ts's list, and the
 * refresh job loads it by its adapter; the two must name the same states.
 *
 * Setup: none.
 */
import { describe, expect, it } from "vitest";
import { MAP_STATES, RANGE_FIPS } from "../src/coverage.js";
import { GEO_STATES } from "../src/ingest/states/index.js";

describe("coverage", () => {
  it("routes to the map exactly the states with an adapter", () => {
    expect([...MAP_STATES].sort()).toEqual(GEO_STATES.map((g) => g.state).sort());
  });

  it("reads no state both by address ranges and from the map", () => {
    expect(MAP_STATES.filter((s) => RANGE_FIPS[s])).toEqual([]);
  });
});
