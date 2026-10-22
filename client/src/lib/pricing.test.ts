import { describe, expect, it } from 'vitest';
import raw from './pricing.json';
import { noteNumbers, pricing } from './pricing';

describe('pricing.json', () => {
	const num = noteNumbers(pricing);

	it('cites only caveats that exist, and every caveat is cited', () => {
		const used = new Set(pricing.rows.flatMap((r) => r.notes));
		for (const id of used) expect(num[id], id).toBeDefined();
		expect(pricing.notes.map((n) => n.id).filter((id) => !used.has(id))).toEqual([]);
	});

	it('gives every row a method and a dated source', () => {
		for (const r of pricing.rows) {
			expect(r.method, r.id).not.toBe('');
			expect(r.sources.length, r.id).toBeGreaterThan(0);
			for (const s of r.sources) expect(s.checked, s.url).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		}
	});

	it('keeps row ids unique and avoids the word "unverified"', () => {
		expect(new Set(pricing.rows.map((r) => r.id)).size).toBe(pricing.rows.length);
		expect(JSON.stringify(raw).toLowerCase()).not.toContain('unverified');
	});
});
