import { marginOf, metresBetween, type SourcedPoint, type LocatedPoint } from "./types.js";
import { PARAMS } from "../params.js";

const order = (a: SourcedPoint, b: SourcedPoint) => marginOf(a) - marginOf(b) || a.provider.localeCompare(b.provider);
export const compatible = (a: LocatedPoint, b: LocatedPoint) =>
  metresBetween(a, b) <= Math.min(PARAMS.agreeCapMetres, PARAMS.agreeFactor * Math.max(marginOf(a), marginOf(b)));

/** The most precise dataset's point and every other dataset that agrees
 * with it. One point per dataset; a dataset contradicting itself is dropped.
 * A point with no independent support gives way to the next most precise.
 * Refused when the datasets left out agree with each other: that is two
 * places, not one. */
export function agreeingGroup(points: SourcedPoint[]): SourcedPoint[] | null {
  const representatives = [...new Set(points.map(p => p.source))].flatMap(source => {
    const members = points.filter(p => p.source === source).sort(order);
    if (members.some(a => members.some(b => !compatible(a, b)))) return [];
    const best = members[0];
    return [{ ...best, metres: Math.max(marginOf(best), ...members.map(p => metresBetween(best, p))) }];
  }).sort(order);
  for (const best of representatives) {
    const group = representatives.filter(p => p === best || compatible(p, best));
    if (group.length < 2) continue;
    const rest = representatives.filter(p => !group.includes(p));
    return rest.some(a => rest.some(b => a !== b && compatible(a, b))) ? null : group;
  }
  return null;
}

export function placement(group: SourcedPoint[]): LocatedPoint {
  const best = [...group].sort(order)[0];
  const metres = Math.ceil(Math.max(marginOf(best), ...group.map(p => metresBetween(best, p))));
  return { lon: best.lon, lat: best.lat, accuracy: best.accuracy, metres,
    placedBy: group.map(p => `${p.provider} (${p.source})`).sort() };
}
