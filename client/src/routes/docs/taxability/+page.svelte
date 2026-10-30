<script lang="ts">
	/** The codes and their definitions, as src/taxability/codes.ts gives them. */
	const CODES: Array<[string, string]> = [
		["goods.general", "Tangible goods sold at retail that no narrower code here describes: furniture, tools, electronics, household goods. Not food, clothing, medicine or other goods a jurisdiction treats on their own."],
		["food.grocery", "Food and food ingredients sold unprepared, for eating at home: produce, meat, dairy, bread, packaged staples. Not candy, soft drinks, alcohol, dietary supplements or tobacco, and not food the seller prepared."],
		["food.candy", "Candy and confectionery: sweets, chocolate, gum, candy bars; not baked goods or anything with flour."],
		["food.soft_drink", "Non-alcoholic beverages with natural or artificial sweeteners: soda, sweetened tea, energy drinks; not milk, juice of more than half fruit or vegetable, or plain water."],
		["food.prepared", "Food the seller sells ready to eat: sold heated, mixed or combined by the seller (sandwiches, salads, meals), or sold with eating utensils the seller provides; delivered meals included. Not catering at the customer's event."],
		["food.prepared.hot", "Prepared food sold heated, above the room's temperature, to go or to stay: a hot meal, a rotisserie chicken from the warmer, a hot sandwich, coffee."],
		["food.prepared.dine_in", "Prepared food, hot or cold, served to be eaten at the seller's tables, counters or premises, or on its plates and tableware."],
		["food.prepared.sandwich", "A cold sandwich, wrap, sub or similar, sold to go."],
		["food.prepared.cold", "Other cold food the seller prepared, sold to go by a grocery, deli or other food store: salads, cut fruit, a cooked chicken sold cold, food sold by weight from the deli counter."],
		["food.prepared.cold_restaurant", "Cold food the seller prepared, sold to go by a restaurant, café or other food-service business: a salad, a cold meal, a cold drink from the counter."],
		["food.prepared.bakery", "Bakery items the seller baked, sold without eating utensils: bread, pastries, muffins, cookies, cakes and pies, even if warmed."],
		["food.prepared.platter", "Prepared food arranged on a platter or tray to go: party trays of sandwiches, cheese, cold cuts, fruit or vegetables."],
		["food.catering", "Food and drink the seller prepares and serves at the customer's event, with the service on the same bill: staff, setup, rentals and service charges."],
		["software.saas", "Prewritten software the customer uses remotely, by subscription or access, without receiving a copy."],
		["software.prewritten", "Prewritten (off-the-shelf) software the customer receives a copy of, downloaded or on media, with its license."],
		["software.custom", "Software written for one customer to its specifications, or prewritten software customized for it; the development work, not a prewritten copy."],
		["software.custom.development", "Software written from scratch for one customer to its specifications."],
		["software.custom.modification", "Changes made to prewritten software for one customer, charged separately from the prewritten copy."],
		["service.professional", "Professional advice or work sold to the customer: legal, accounting, consulting, engineering and similar, where the product is the professional's work rather than goods or software."],
		["service.professional.legal", "Legal services: advice, representation, drafting by a lawyer or notary."],
		["service.professional.accounting", "Accounting, auditing, bookkeeping and tax return preparation."],
		["service.professional.consulting", "Management and business consulting: strategy, operations, finance or human-resources advice, not IT and not advertising."],
		["service.professional.it", "Information technology services: IT consulting, systems integration, network and help-desk support, IT training; not writing software."],
		["service.professional.engineering", "Engineering and architectural design services."],
		["service.professional.design", "Interior design and decorating services."],
		["service.professional.advertising", "Advertising agency services: advice on, design of and placement of advertising."],
		["construction.real_property", "Building, repairing, painting or improving the customer's building or land, labour and materials billed together, sold to the owner (not to another contractor)."],
		["construction.real_property.improvement", "New construction, or a capital improvement or remodel that becomes part of the building or land and adds to its value or life: an addition, a new roof, a kitchen remodel."],
		["construction.real_property.repair", "Repair, maintenance or repainting of an existing building or its fixtures: fixing a leak, replacing a broken step, repainting."],
		["delivery", "A separately stated charge for delivering goods to the buyer."],
		["delivery.taxable_goods", "A separately stated charge for delivering goods that are taxable at that sale."],
		["delivery.exempt_goods", "A separately stated charge for delivering goods that are exempt at that sale, such as groceries."],
		["nontaxable", "An amount that isn't a sale of anything: card fees passed through, deposits held, reimbursements. The caller's assertion; no jurisdiction's rule is consulted."]
	];

	/** OpenTaxRate, Streamlined definition, Stripe Tax, TaxJar, Avalara; * is
	 *  the nearest code where the provider has no exact match. */
	const MAPPING: Array<[string, string, string, string, string]> = [
		['goods.general', 'tangible personal property', 'txcd_99999999', '(none)', 'P0000000'],
		['food.grocery', 'food and food ingredients', 'txcd_40040000', '40030', 'PF050002'],
		['food.prepared', 'prepared food', 'txcd_40060003', '41000', 'PA0010000'],
		['food.catering', 'prepared food (catering)', 'txcd_40060003*', '41000*', 'SF096370'],
		['software.saas', 'prewritten computer software, remote access', 'txcd_10103001', '30070', 'SW054003'],
		['software.custom', 'computer software, not prewritten', 'txcd_10203001', '19005*', 'DC010200'],
		['service.professional', "(services aren't defined)", 'txcd_20060000', '19005', 'SC160000'],
		['construction.real_property', '(not defined)', 'txcd_20070010', '(none)', 'SC150603'],
		['delivery', 'delivery charges', 'txcd_92010001', 'shipping', 'FR010000'],
		['nontaxable', '—', 'txcd_00000000', '(none)', 'ON030000']
	];

	const CONDITIONAL = `"food.prepared": {
  "treatment": "conditional",
  "rate": null,
  "taxes": [
    {
      "tax": "CA",
      "parts": [...],
      "treatment": "conditional",
      "rate": null,
      "rule": {
        "summary": "Ready-to-eat food is taxable when hot, served as a meal or for eating at the retailer's facilities, or sold to go by a seller meeting the 80-80 rule; otherwise cold food to go is exempt.",
        "conditions": [
          { "when": "Sold as a hot prepared food product ...", "treatment": "taxable" },
          { "when": "Served as a meal, or furnished for consumption at tables ...", "treatment": "taxable" },
          { "when": "Cold food to go ... (80-80 rule)", "treatment": "taxable" },
          { "when": "Cold food to go ..., when none of the above applies", "treatment": "exempt" },
          ...
        ],
        "citations": [ { "title": "Cal. Rev. & Tax. Code § 6359(d)", "url": "https://www.cdtfa.ca.gov/lawguides/vol1/sutl/6359.html" }, ... ]
      }
    }
  ]
}`;
</script>

<svelte:head>
	<title>Taxability codes · OpenTaxRate Docs</title>
	<meta name="description" content="The codes OpenTaxRate's code= parameter takes, what each covers, and how the answer says whether that sale is taxed." />
</svelte:head>

<h1>Taxability codes</h1>
<p class="lead">
	Name what was sold with <code>code</code>, and the answer says whether that sale is taxed at the address and at what rate, with
	the government page that says so.
</p>

<h2 id="codes">What a code is</h2>
<p>
	A code names what the thing sold is, in just enough detail for the tax rules to tell it apart from the next thing. Tax law
	doesn't care whose laptop it is; it cares whether it's a tangible good, food, software or a service, and within food whether
	someone prepared it. A code says only what the thing is, the same everywhere; a rule says how one place's tax treats it from a
	date. Who bought it (a reseller, an exempt organization) and where the sale is sourced are yours to decide.
</p>
<p>
	Pass one or more, comma-separated, so an invoice with several kinds of line is one lookup:
	<code>&amp;code=food.catering,delivery</code>. An unknown code is a 400 listing the valid ones, so a typo can't look like
	<code>not_researched</code>. See <a class="link" href="/docs#taxability">Taxability</a> in the API reference for the response.
</p>
<p>
	Codes form a hierarchy: <code>food.prepared.hot</code> is a narrower kind of <code>food.prepared</code>. Send the narrowest
	code that's true. It carries the fact a state's rule turns on (hot or cold, legal or IT, repair or improvement), so the answer
	comes back settled instead of <code>conditional</code>. A parent code still answers: from its own rule where a place treats
	every kind alike, else as conditional on its subcodes, each listed in the rule's <code>conditions</code>.
</p>
<table>
	<thead><tr><th>Code</th><th>What it covers</th></tr></thead>
	<tbody>
		{#each CODES as [code, definition] (code)}
			<tr id={code}><td class={CODES.some(([parent]) => code.startsWith(parent + '.')) ? 'sub' : ''}><code>{code}</code></td><td>{definition}</td></tr>
		{/each}
	</tbody>
</table>
<p>
	The list grows only when a rule needs a split: clothing, medicine and digital goods each get a code when their rules are
	researched.
</p>

<h2 id="mapping">Other taxonomies</h2>
<p>
	The definitions follow the Streamlined Sales Tax Library of Definitions, which 24 states have written into their own law word
	for word; New York and California aren't members, but their tests line up with the same ideas, and where a state tests
	differently, that difference is in the rule's <code>conditions</code>, not a different code. If you already have a product tax
	code from another provider, translate it with this table.
</p>
<table>
	<thead><tr><th>OpenTaxRate</th><th>Streamlined definition</th><th>Stripe Tax</th><th>TaxJar</th><th>Avalara</th></tr></thead>
	<tbody>
		{#each MAPPING as [code, sst, stripe, taxjar, avalara] (code)}
			<tr><td><code>{code}</code></td><td>{sst}</td><td><code>{stripe}</code></td><td><code>{taxjar}</code></td><td><code>{avalara}</code></td></tr>
		{/each}
	</tbody>
</table>
<p>* The nearest code; that provider has no exact match.</p>

<h2 id="coverage">Coverage</h2>
<p>
	Rules are researched for Washington, New York, California and every Canadian province and territory. Each one
	is read from the state's or agency's own statutes, regulations and bulletins, and cites the pages it came from. No state
	publishes taxability as data, so the rules are written down by hand from those pages and tested against the agencies' worked
	examples.
</p>
<p>
	Everywhere else, and any code or date without a rule there, answers <code>not_researched</code>. The general <code>rate</code> is
	still returned as always. <code>GET /v1/coverage</code> lists each state's <code>taxabilityCodes</code>: the codes with a
	researched rule there today.
</p>

<h2 id="treatments">Treatments</h2>
<p>Each entry's <code>treatment</code> describes the sale as a whole.</p>
<table>
	<thead><tr><th>Treatment</th><th>Meaning</th><th><code>rate</code></th></tr></thead>
	<tbody>
		<tr><td><code>taxable</code></td><td>Every part at its rate.</td><td>The combined rate</td></tr>
		<tr><td><code>partial</code></td><td>Some parts, or a reduced rate: a restaurant meal in British Columbia pays GST but not PST.</td><td>The sum of the taxing parts</td></tr>
		<tr><td><code>not_taxed</code></td><td>No part taxes it.</td><td><code>0</code></td></tr>
		<tr><td><code>conditional</code></td><td>The outcome turns on facts the code doesn't fix, listed in the rules' <code>conditions</code>.</td><td><code>null</code></td></tr>
		<tr><td><code>not_researched</code></td><td>A part has no researched rule for this code on this date.</td><td><code>null</code></td></tr>
	</tbody>
</table>
<p>
	Each of <code>taxes</code> carries the legal treatment of its parts: <code>taxable</code>, <code>exempt</code>,
	<code>zero_rated</code>, <code>conditional</code>, <code>not_a_sale</code> or <code>not_researched</code>. Exempt and zero-rated
	both mean no tax, but a Canadian return reports them on different lines. A rule's <code>fromIs</code> is <code>effective</code>
	when its sources give the day it took effect, and <code>earliest_verified</code> when it's likely older but earlier dates aren't
	researched; those earlier dates answer <code>not_researched</code>.
</p>

<h2 id="reading">Reading a conditional answer</h2>
<p>
	When <code>rate</code> is a number, charge it. When it's <code>null</code> and the treatment is <code>conditional</code>, show the
	rules' <code>conditions</code> and let a person pick the one that applies; each names its own <code>treatment</code> and, where a
	part's rate is reduced, its <code>rate</code>. When it's <code>null</code> and <code>not_researched</code>, send the sale to
	another engine or a person. Never use the general rate in its place.
</p>
<pre><code>{CONDITIONAL}</code></pre>
<p>
	A sandwich to go in Los Angeles is conditional: hot, it's taxed; cold, it isn't, unless the seller falls under California's 80-80
	rule. The code can't say which, so the answer lists each case (shortened above; the API returns each condition in full).
</p>

<style>
	.sub {
		padding-left: 1.75rem;
	}
</style>
