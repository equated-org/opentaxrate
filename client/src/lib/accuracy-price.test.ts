import { describe, expect, it } from 'vitest';
import { isDominated, points, type Point } from './accuracy-price';

const point = (price: number, accuracy: number, conditional = false): Point => ({
	id: 'example', name: 'Example', price, accuracy, conditional,
	asked: 100, right: accuracy, note: ''
});

describe('accuracy–price comparison', () => {
	it('requires a strict improvement with neither axis worse', () => {
		expect(isDominated(point(2, 98), [point(2, 98)])).toBe(false);
		expect(isDominated(point(2, 98), [point(1, 98)])).toBe(true);
		expect(isDominated(point(2, 98), [point(2, 99)])).toBe(true);
		expect(isDominated(point(2, 98), [point(1, 97), point(3, 99)])).toBe(false);
	});
	it('does not let conditional prices determine the frontier', () => {
		expect(isDominated(point(2, 98), [point(1, 99, true)])).toBe(false);
		expect(isDominated(point(2, 98, true), [point(1, 99)])).toBe(false);
	});
	it('does not invent an accuracy for free, self-hosted or untested alternatives', () => {
		expect(points.map((p) => p.id).sort()).toEqual(['apiverve', 'avalara', 'geoverio', 'opentaxrate-api', 'taxcloud', 'taxjar']);
		const ours = points.find((p) => p.id === 'opentaxrate-api')!;
		expect(ours.accuracy).toBeCloseTo(275 / 277 * 100);
		expect(ours.price).toBe(1.95);
		expect(isDominated(ours, points)).toBe(false);
		const cheaper = points.find((p) => p.id === 'geoverio')!;
		expect(cheaper.price).toBeLessThan(ours.price);
		expect(cheaper.accuracy).toBeLessThan(ours.accuracy);
		expect(isDominated(cheaper, points)).toBe(false);
		expect(isDominated(points.find((p) => p.id === 'taxjar')!, points)).toBe(true);
	});
	it('plots APIVerve with its separate sample and full plan cost at the shared volume', () => {
		const api = points.find((p) => p.id === 'apiverve')!;
		expect(api.asked).toBe(87);
		expect(api.accuracy).toBeCloseTo(76 / 87 * 100);
		expect(api.price).toBeCloseTo(29.99 / 2);
		expect(api.conditional).toBe(true);
		expect(api.note).toContain('Separate sample');
	});
});
