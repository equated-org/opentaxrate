/**
 * What was sold, as a closed list of codes in a hierarchy: a code with
 * dots below another ("food.prepared.hot" under "food.prepared") is a
 * narrower kind of it. A rule says how one jurisdiction's tax treats a
 * code on a date (rules/); the code itself says only what the thing is,
 * the same everywhere. Who bought it (a reseller, an exempt organization)
 * and where the sale is sourced are the caller's.
 *
 * Send the narrowest code that's true: it carries the fact a state's rule
 * turns on (hot or cold, legal or IT), so fewer answers come back
 * conditional. A parent code still answers: by its own rule where a place
 * treats every kind alike, else as conditional on its subcodes.
 */
export const TAX_CODES = {
  "goods.general": "Tangible goods sold at retail that no narrower code here describes: furniture, tools, electronics, household goods. Not food, clothing, medicine or other goods a jurisdiction treats on their own.",

  "food.grocery": "Food and food ingredients sold unprepared, for eating at home: produce, meat, dairy, bread, packaged staples. Not candy, soft drinks, alcohol, dietary supplements or tobacco, and not food the seller prepared.",
  "food.candy": "Candy and confectionery: sweets, chocolate, gum, candy bars; not baked goods or anything with flour.",
  "food.soft_drink": "Non-alcoholic beverages with natural or artificial sweeteners: soda, sweetened tea, energy drinks; not milk, juice of more than half fruit or vegetable, or plain water.",

  "food.prepared": "Food the seller sells ready to eat: sold heated, mixed or combined by the seller (sandwiches, salads, meals), or sold with eating utensils the seller provides; delivered meals included. Not catering at the customer's event.",
  "food.prepared.hot": "Prepared food sold heated, above the room's temperature, to go or to stay: a hot meal, a rotisserie chicken from the warmer, a hot sandwich, coffee.",
  "food.prepared.dine_in": "Prepared food, hot or cold, served to be eaten at the seller's tables, counters or premises, or on its plates and tableware.",
  "food.prepared.sandwich": "A cold sandwich, wrap, sub or similar, sold to go.",
  "food.prepared.cold": "Other cold food the seller prepared, sold to go by a grocery, deli or other food store: salads, cut fruit, a cooked chicken sold cold, food sold by weight from the deli counter.",
  "food.prepared.cold_restaurant": "Cold food the seller prepared, sold to go by a restaurant, café or other food-service business: a salad, a cold meal, a cold drink from the counter.",
  "food.prepared.bakery": "Bakery items the seller baked, sold without eating utensils: bread, pastries, muffins, cookies, cakes and pies, even if warmed.",
  "food.prepared.platter": "Prepared food arranged on a platter or tray to go: party trays of sandwiches, cheese, cold cuts, fruit or vegetables.",

  "food.catering": "Food and drink the seller prepares and serves at the customer's event, with the service on the same bill: staff, setup, rentals and service charges.",

  "software.saas": "Prewritten software the customer uses remotely, by subscription or access, without receiving a copy.",
  "software.prewritten": "Prewritten (off-the-shelf) software the customer receives a copy of, downloaded or on media, with its license.",
  "software.custom": "Software written for one customer to its specifications, or prewritten software customized for it; the development work, not a prewritten copy.",
  "software.custom.development": "Software written from scratch for one customer to its specifications.",
  "software.custom.modification": "Changes made to prewritten software for one customer, charged separately from the prewritten copy.",

  "service.professional": "Professional advice or work sold to the customer: legal, accounting, consulting, engineering and similar, where the product is the professional's work rather than goods or software.",
  "service.professional.legal": "Legal services: advice, representation, drafting by a lawyer or notary.",
  "service.professional.accounting": "Accounting, auditing, bookkeeping and tax return preparation.",
  "service.professional.accounting.tax_return": "Preparing and filing a person's own income tax return, alone.",
  "service.professional.consulting": "Management and business consulting: strategy, operations, finance or human-resources advice, not IT and not advertising.",
  "service.professional.it": "Information technology services: IT consulting, systems integration, network and help-desk support, IT training; not writing software.",
  "service.professional.engineering": "Engineering and architectural design services.",
  "service.professional.design": "Interior design and decorating services.",
  "service.professional.advertising": "Advertising agency services: advice on, design of and placement of advertising.",
  "service.professional.lobbying": "Lobbying a government on the customer's behalf.",

  "construction.real_property": "Building, repairing, painting or improving the customer's building or land, labour and materials billed together, sold to the owner (not to another contractor).",
  "construction.real_property.improvement": "New construction, or a capital improvement or remodel that becomes part of the building or land and adds to its value or life: an addition, a new roof, a kitchen remodel.",
  "construction.real_property.improvement.flooring": "Supplying and installing floor covering in a building: wall-to-wall carpet, vinyl, tile, hardwood or laminate.",
  "construction.real_property.repair": "Repair, maintenance or repainting of an existing building or its fixtures: fixing a leak, replacing a broken step, repainting.",

  delivery: "A separately stated charge for delivering goods to the buyer.",
  "delivery.taxable_goods": "A separately stated charge for delivering goods that are taxable at that sale.",
  "delivery.taxable_goods.mail": "Postage for taxable goods sent by the postal service, separately stated at its cost.",
  "delivery.taxable_goods.carrier": "Shipping of taxable goods by a common or contract carrier (not the seller's own vehicle), separately stated, the buyer owning the goods once shipped (F.O.B. origin).",
  "delivery.exempt_goods": "A separately stated charge for delivering goods that are exempt at that sale, such as groceries.",

  nontaxable: "An amount that isn't a sale of anything: card fees passed through, deposits held, reimbursements. The caller's assertion; no jurisdiction's rule is consulted.",
} as const;

export type TaxCode = keyof typeof TAX_CODES;

export const isTaxCode = (code: string): code is TaxCode => Object.hasOwn(TAX_CODES, code);

/** The code a code narrows ("food.prepared" for "food.prepared.hot"), or null. */
export function parentOf(code: TaxCode): TaxCode | null {
  const parent = code.slice(0, code.lastIndexOf("."));
  return code.includes(".") && isTaxCode(parent) ? parent : null;
}

/** The codes directly under a code. */
export const subcodesOf = (code: TaxCode): TaxCode[] => (Object.keys(TAX_CODES) as TaxCode[]).filter((c) => parentOf(c) === code);
