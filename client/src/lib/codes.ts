/**
 * The taxability codes the API's code= takes (src/taxability/codes.ts), with
 * a short name for each, grouped as a picker shows them; a subcode follows
 * its parent. The full definitions are on /docs/taxability.
 */
export const CODE_GROUPS: Array<{ group: string; codes: Array<[code: string, name: string]> }> = [
	{ group: 'Goods', codes: [['goods.general', 'General goods']] },
	{
		group: 'Food',
		codes: [
			['food.grocery', 'Groceries'],
			['food.candy', 'Candy'],
			['food.soft_drink', 'Soft drinks'],
			['food.prepared', 'Prepared food'],
			['food.prepared.hot', 'Hot food'],
			['food.prepared.dine_in', 'Eaten on site'],
			['food.prepared.sandwich', 'Cold sandwich to go'],
			['food.prepared.cold', 'Cold food from a store or deli'],
			['food.prepared.cold_restaurant', 'Cold food from a restaurant'],
			['food.prepared.bakery', 'Bakery items'],
			['food.prepared.platter', 'Platters and trays'],
			['food.catering', 'Catering']
		]
	},
	{
		group: 'Software',
		codes: [
			['software.saas', 'SaaS'],
			['software.prewritten', 'Prewritten software (a copy)'],
			['software.custom', 'Custom software'],
			['software.custom.development', 'Built for one customer'],
			['software.custom.modification', 'Customizing prewritten software']
		]
	},
	{
		group: 'Services',
		codes: [
			['service.professional', 'Professional services'],
			['service.professional.legal', 'Legal'],
			['service.professional.accounting', 'Accounting'],
			['service.professional.accounting.tax_return', 'Personal tax return'],
			['service.professional.consulting', 'Management consulting'],
			['service.professional.it', 'IT services'],
			['service.professional.engineering', 'Engineering and architecture'],
			['service.professional.design', 'Interior design'],
			['service.professional.advertising', 'Advertising'],
			['service.professional.lobbying', 'Lobbying']
		]
	},
	{
		group: 'Construction',
		codes: [
			['construction.real_property', 'Construction for an owner'],
			['construction.real_property.improvement', 'New work, improvement'],
			['construction.real_property.improvement.flooring', 'Flooring installed'],
			['construction.real_property.repair', 'Repair, maintenance']
		]
	},
	{
		group: 'Delivery',
		codes: [
			['delivery', 'Delivery charge'],
			['delivery.taxable_goods', 'Delivering taxable goods'],
			['delivery.taxable_goods.mail', 'By mail, at cost'],
			['delivery.taxable_goods.carrier', 'By carrier, F.O.B. origin'],
			['delivery.exempt_goods', 'Delivering exempt goods']
		]
	},
	{ group: 'Other', codes: [['nontaxable', 'Not a sale (fees, deposits)']] }
];

const NAMES = new Map(CODE_GROUPS.flatMap((g) => g.codes));

/** A code's short name, else the code. */
export const codeName = (code: string) => NAMES.get(code) ?? code;

/** How many codes in the list a code sits under: 0 for a top-level code. */
export function depth(code: string): number {
	let d = 0;
	for (let c = code; c.includes('.'); ) {
		c = c.slice(0, c.lastIndexOf('.'));
		if (NAMES.has(c)) d++;
	}
	return d;
}

export const isCode = (code: string) => NAMES.has(code);
