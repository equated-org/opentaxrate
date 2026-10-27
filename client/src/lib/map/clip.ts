/** Cutting polygon rings down to a rectangle (Sutherland–Hodgman), so an
 *  outline of 50,000 points draws, or is saved, as the few hundred in view.
 *  A ring that leaves the box comes back with stretches along its edge,
 *  which is right for a fill clipped to that box. */

export type Point = [number, number];
export interface Box {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

function edge(ring: Point[], inside: (p: Point) => boolean, cut: (a: Point, b: Point) => Point): Point[] {
	const out: Point[] = [];
	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		if (inside(b)) {
			if (!inside(a)) out.push(cut(a, b));
			out.push(b);
		} else if (inside(a)) out.push(cut(a, b));
	}
	return out;
}

export function clipRing(ring: Point[], { x0, y0, x1, y1 }: Box): Point[] {
	const atX = (x: number) => (a: Point, b: Point): Point => [x, a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0])];
	const atY = (y: number) => (a: Point, b: Point): Point => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
	let r = ring;
	r = edge(r, (p) => p[0] >= x0, atX(x0));
	r = edge(r, (p) => p[0] <= x1, atX(x1));
	r = edge(r, (p) => p[1] >= y0, atY(y0));
	r = edge(r, (p) => p[1] <= y1, atY(y1));
	return r;
}

/** A GeoJSON Polygon's or MultiPolygon's rings; none for anything else. */
export function ringsOf(geometry: unknown): Point[][] {
	const g = geometry as { type?: string; coordinates?: unknown } | undefined;
	if (g?.type === 'Polygon') return g.coordinates as Point[][];
	if (g?.type === 'MultiPolygon') return (g.coordinates as Point[][][]).flat();
	return [];
}
