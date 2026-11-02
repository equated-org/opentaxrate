import { describe, expect, it } from 'vitest';
import { archivedOn, offline, offlineChecked } from './evidence';
import list from './offline-originals.json';

describe('offline-originals.json', () => {
	it('is dated and lists absolute URLs with a reason', () => {
		expect(offlineChecked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		for (const [url, why] of Object.entries(list.urls as Record<string, string>)) {
			expect(() => new URL(url)).not.toThrow();
			expect(why.length).toBeGreaterThan(0);
			expect(offline(url)).toBe(true);
		}
	});
	it('matches whole URLs only', () => {
		expect(offline('https://example.com/not-listed')).toBe(false);
	});
});

describe('archivedOn', () => {
	it('opens the dated copy at a short quote', () => {
		expect(archivedOn('https://a.gov/p', '2026-11-01', 'food is exempt')).toBe('https://evidence.opentaxrate.com/20261101/https://a.gov/p#:~:text=food%20is%20exempt');
	});
});
