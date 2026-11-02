import { describe, expect, it } from 'vitest';
import { saleRates, type Taxability } from './api';

const group = (tax: string, rate: number | null) => ({ tax, parts: [tax], treatment: rate === null ? ('conditional' as const) : ('taxable' as const), rate, rule: null });

describe('saleRates', () => {
	it("lists a paired answer's outcome rates, highest first", () => {
		const t: Taxability = { treatment: 'conditional', rate: null, taxes: [group('VT', null), group('VT:local', null)], outcomes: [{ when: 'a', rate: 0 }, { when: 'b', rate: 0.1 }, { when: 'c', rate: 0.09 }, { when: 'd', rate: 0 }] };
		expect(saleRates(t)).toEqual([0.1, 0.09, 0]);
	});

	it('combines one case per tax on an independent answer, the settled taxes once', () => {
		const t: Taxability = {
			treatment: 'conditional',
			rate: null,
			taxes: [group('CA:GST/HST', 0.05), group('MB:RST', null), group('X', null)],
			independent: true,
			outcomes: [
				{ when: 'MB:RST: a', rate: 0.05, tax: 'MB:RST' },
				{ when: 'MB:RST: b', rate: 0.12, tax: 'MB:RST' },
				{ when: 'X: c', rate: 0.05, tax: 'X' },
				{ when: 'X: d', rate: 0.06, tax: 'X' },
			],
		};
		expect(saleRates(t)).toEqual([0.13, 0.12, 0.06, 0.05]);
	});
});
