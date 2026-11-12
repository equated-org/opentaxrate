/**
 * The taxability codes the API's code= takes (src/taxability/codes.ts), with
 * a short name for each, grouped as a picker shows them; a subcode follows
 * its parent. The full definitions are on /docs/taxability.
 *
 * Only the server's TaxCode type is imported (erased at build), so the
 * bundle carries no server code; `satisfies` below makes a server code
 * without a name here, or a name for a code the server lacks, a type error
 * in `pnpm check`.
 */
import type { TaxCode } from '../../../src/taxability/codes';

type Group = { group: string; codes: Array<[code: TaxCode, name: string]> };

const GROUPS = [
	{ group: 'Goods', codes: [['goods.general', 'General goods']] },
	{
		group: 'Clothing',
		codes: [
			['clothing', 'Clothing and footwear'],
			['clothing.accessories', 'Accessories (jewelry, bags)'],
			['clothing.equipment', 'Protective and sport gear'],
			['clothing.other', 'Everyday clothing']
		]
	},
	{
		group: 'Alcohol',
		codes: [
			['alcohol', 'Alcoholic beverages'],
			['alcohol.off_premises', 'To take away'],
			['alcohol.on_premises', 'Served at a bar or restaurant']
		]
	},
	{
		group: 'Food',
		codes: [
			['food.grocery', 'Groceries'],
			['food.uncooked', 'Assembled, to cook at home'],
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
	{ group: 'Rental', codes: [['rental', 'Renting goods']] },
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
			['service.goods', 'Work on customer goods'],
			['service.goods.repair', 'Repair, alteration'],
			['service.goods.cleaning', 'Cleaning, laundry'],
			['service.goods.other', 'Engraving, embroidery, other'],
			['service.professional', 'Professional services'],
			['service.professional.legal', 'Legal'],
			['service.professional.accounting', 'Accounting'],
			['service.professional.accounting.tax_return', 'Personal tax return'],
			['service.professional.accounting.other', 'Other accounting'],
			['service.professional.consulting', 'Management consulting'],
			['service.professional.it', 'IT services'],
			['service.professional.engineering', 'Engineering and architecture'],
			['service.professional.design', 'Interior design'],
			['service.professional.advertising', 'Advertising'],
			['service.professional.lobbying', 'Lobbying'],
			['service.professional.other', 'Other professional service']
		]
	},
	{
		group: 'Construction',
		codes: [
			['construction.real_property', 'Construction for an owner'],
			['construction.real_property.improvement', 'New work, improvement'],
			['construction.real_property.improvement.flooring', 'Flooring installed'],
			['construction.real_property.improvement.other', 'Other new work'],
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
			['delivery.taxable_goods.other', 'Other delivery of taxable goods'],
			['delivery.exempt_goods', 'Delivering exempt goods']
		]
	},
	{ group: 'Other', codes: [['nontaxable', 'Not a sale (fees, deposits)']] }
] satisfies Group[];

type Named = (typeof GROUPS)[number]['codes'][number][0];
// A server code with no name above is a type error here.
({}) as Record<Named, string> satisfies Record<TaxCode, string>;

const pairs = (GROUPS as Group[]).flatMap((g) => g.codes);

export const CODE_GROUPS: Array<{ group: string; codes: Array<[code: string, name: string]> }> = GROUPS;

const NAMES = new Map<string, string>(pairs);

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
