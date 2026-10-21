import { marginOf, metresBetween, type SourcedPoint, type LocatedPoint } from "./types.js";

const order = (a: SourcedPoint, b: SourcedPoint) => marginOf(a) - marginOf(b) || a.provider.localeCompare(b.provider);
export const compatible = (a: LocatedPoint, b: LocatedPoint) =>
  metresBetween(a, b) <= Math.min(250, Math.max(marginOf(a), marginOf(b)));

/** One representative per dataset; contradictory results remove that dataset.
 * Groups are pairwise-compatible cliques, never transitive chains. A tie refuses.
 * Unknown provenance cannot supply an independent vote. */
export function agreeingGroup(points: SourcedPoint[]): SourcedPoint[] | null {
  const sources = [...new Set(points.map(p => p.source))].filter(s => s !== "unknown");
  const representatives = sources.flatMap(source => {
    const members = points.filter(p => p.source === source).sort(order);
    if (members.some(a => members.some(b => !compatible(a, b)))) return [];
    const best = members[0];
    return [{ ...best, metres: Math.max(marginOf(best), ...members.map(p => metresBetween(best, p))) }];
  });
  let largest: SourcedPoint[][] = [];
  for (let mask = 1; mask < 2 ** representatives.length; mask++) {
    const group = representatives.filter((_, i) => mask & 2 ** i);
    if (group.length < 2 || group.length < (largest[0]?.length ?? 0)) continue;
    if (group.some(a => group.some(b => !compatible(a, b)))) continue;
    if (group.length > (largest[0]?.length ?? 0)) largest = [];
    largest.push(group);
  }
  return largest.length === 1 ? largest[0] : null;
}

export function placement(group: SourcedPoint[]): LocatedPoint {
  const best = [...group].sort(order)[0];
  const metres = Math.ceil(Math.max(marginOf(best), ...group.map(p => metresBetween(best, p))));
  return { lon: best.lon, lat: best.lat, accuracy: best.accuracy, metres,
    placedBy: group.map(p => `${p.provider} (${p.source})`).sort() };
}
