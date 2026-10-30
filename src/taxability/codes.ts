/**
 * What was sold, as a short closed list of codes. A rule says how one
 * jurisdiction's tax treats a code on a date (rules/); the code itself says
 * only what the thing is, the same everywhere. Who bought it (a reseller, an
 * exempt organization) and where the sale is sourced are the caller's.
 */
export const TAX_CODES = {
  "goods.general": "Tangible goods sold at retail that no narrower code here describes: furniture, tools, electronics, household goods. Not food, clothing, medicine or other goods a jurisdiction treats on their own.",
  "food.grocery": "Food and food ingredients sold unprepared, for eating at home: produce, meat, dairy, bread, packaged staples. Not candy, soft drinks, alcohol, dietary supplements or tobacco, and not food the seller prepared.",
  "food.prepared": "Food the seller sells ready to eat: sold heated, mixed or combined by the seller (sandwiches, salads, meals), or sold with eating utensils the seller provides; delivered meals included. Not catering at the customer's event.",
  "food.catering": "Food and drink the seller prepares and serves at the customer's event, with the service on the same bill: staff, setup, rentals and service charges.",
  "software.saas": "Prewritten software the customer uses remotely, by subscription or access, without receiving a copy.",
  "software.custom": "Software written for one customer to its specifications, or prewritten software customized for it; the development work, not a prewritten copy.",
  "service.professional": "Professional advice or work sold to the customer: legal, accounting, consulting, engineering and similar, where the product is the professional's work rather than goods or software.",
  "construction.real_property": "Building, repairing, painting or improving the customer's building or land, labour and materials billed together, sold to the owner (not to another contractor).",
  delivery: "A separately stated charge for delivering goods to the buyer.",
  nontaxable: "An amount that isn't a sale of anything: card fees passed through, deposits held, reimbursements. The caller's assertion; no jurisdiction's rule is consulted.",
} as const;

export type TaxCode = keyof typeof TAX_CODES;

export const isTaxCode = (code: string): code is TaxCode => Object.hasOwn(TAX_CODES, code);
