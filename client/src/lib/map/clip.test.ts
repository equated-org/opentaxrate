import { describe, expect, it } from 'vitest';
import { clipRing, ringsOf, type Point } from './clip';

const box = { x0: 0, y0: 0, x1: 10, y1: 10 };

describe('clipRing', () => {
	it('keeps a ring inside the box as it is', () => {
		const ring: Point[] = [[1, 1], [9, 1], [9, 9], [1, 9]];
		expect(clipRing(ring, box)).toEqual(ring);
	});

	it('cuts a ring that crosses the box at its edges', () => {
		const ring: Point[] = [[-5, 2], [5, 2], [5, 8], [-5, 8]];
		const clipped = clipRing(ring, box);
		expect(clipped.every(([x, y]) => x >= 0 && x <= 10 && y >= 0 && y <= 10)).toBe(true);
		expect(clipped).toContainEqual([0, 2]);
		expect(clipped).toContainEqual([5, 8]);
	});

	it('returns nothing for a ring wholly outside', () => {
		expect(clipRing([[20, 20], [30, 20], [30, 30]], box)).toEqual([]);
	});

	it('fills the box when the ring surrounds it', () => {
		const clipped = clipRing([[-1, -1], [11, -1], [11, 11], [-1, 11]], box);
		expect(new Set(clipped.map((p) => p.join()))).toEqual(new Set(['0,0', '10,0', '10,10', '0,10']));
	});
});

describe('ringsOf', () => {
	it('reads polygons and multipolygons, and nothing else', () => {
		const ring: Point[] = [[0, 0], [1, 0], [1, 1]];
		expect(ringsOf({ type: 'Polygon', coordinates: [ring] })).toEqual([ring]);
		expect(ringsOf({ type: 'MultiPolygon', coordinates: [[ring], [ring]] })).toEqual([ring, ring]);
		expect(ringsOf({ type: 'Point', coordinates: [0, 0] })).toEqual([]);
		expect(ringsOf(undefined)).toEqual([]);
	});
});
