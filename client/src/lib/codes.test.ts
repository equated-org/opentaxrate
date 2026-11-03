import { describe, expect, it } from 'vitest';
import { CODE_GROUPS, codeName, depth, isCode } from './codes';

describe('code list', () => {
	it('names the clothing and alcohol codes, each subcode after its parent', () => {
		for (const code of ['clothing', 'clothing.accessories', 'clothing.equipment', 'clothing.other', 'alcohol', 'alcohol.off_premises', 'alcohol.on_premises']) {
			expect(isCode(code), code).toBe(true);
			expect(codeName(code), code).not.toBe(code);
		}
		expect(depth('clothing')).toBe(0);
		expect(depth('clothing.accessories')).toBe(1);
		expect(depth('alcohol.on_premises')).toBe(1);
		for (const code of ['rental', 'service.goods', 'service.goods.repair', 'service.goods.cleaning', 'service.goods.other']) expect(isCode(code), code).toBe(true);
		expect(depth('service.goods.cleaning')).toBe(1);
		const order = CODE_GROUPS.flatMap((g) => g.codes.map(([c]) => c));
		for (const sub of ['clothing.accessories', 'clothing.equipment', 'clothing.other', 'alcohol.off_premises', 'alcohol.on_premises'])
			expect(order.indexOf(sub.slice(0, sub.lastIndexOf('.')))).toBeLessThan(order.indexOf(sub));
	});
});
