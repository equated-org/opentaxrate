<script lang="ts">
	import { depth } from '$lib/codes';

	let { data } = $props();
	/** The codes and their definitions, from src/taxability/codes.ts (+page.server.ts). */
	const CODES = $derived(data.codes);

	/** OpenTaxRate, Streamlined definition, Stripe Tax, TaxJar, Avalara; * is
	 *  the nearest code where the provider has no exact match. */
	const MAPPING: Array<[string, string, string, string, string]> = [
		['goods.general', 'tangible personal property', 'txcd_99999999', '(none)', 'P0000000'],
		['clothing', 'clothing', 'txcd_30011000', '20010', 'PC040100'],
		['alcohol.off_premises', 'alcoholic beverages', 'txcd_41020001*', '50202201A0000*', 'PA2020200*'],
		['alcohol.on_premises', 'alcoholic beverages', '(none)', '(none)', 'PA2010200*'],
		['food.grocery', 'food and food ingredients', 'txcd_40040000', '40030', 'PF050002'],
		['food.prepared', 'prepared food', 'txcd_40060003', '41000', 'PA0010000'],
		['food.catering', 'prepared food (catering)', 'txcd_40060003*', '41000*', 'SF096370'],
		['rental', 'lease or rental', '(none)', '(none)', 'PR091000'],
		['service.goods.repair', '(services aren\'t defined)', 'txcd_20080005', '19007', 'SR060200'],
		['service.goods.cleaning', '(services aren\'t defined)', 'txcd_20090004*', '19006*', '(none)'],
		['software.saas', 'prewritten computer software, remote access', 'txcd_10103001', '30070', 'SW054003'],
		['software.custom', 'computer software, not prewritten', 'txcd_10203001', '19005*', 'DC010200'],
		['service.professional', "(services aren't defined)", 'txcd_20060000', '19005', 'SC160000'],
		['construction.real_property', '(not defined)', 'txcd_20070010', '(none)', 'SC150603'],
		['delivery', 'delivery charges', 'txcd_92010001', 'shipping', 'FR010000'],
		['nontaxable', '—', 'txcd_00000000', '(none)', 'ON030000']
	];

	const DESCRIBE_LINE = `GET /v1/rate?address=210+Capitol+Ave,+Hartford,+CT+06106&date=2026-11-02
  &describe=monthly subscription to an online photo-editing app for a family's personal use`;

	const DESCRIBE_RESPONSE = `"monthly subscription to an online photo-editing app for a family's personal use": {
  "treatment": "taxable",
  "rate": 0.0635,
  "taxes": [
    {
      "tax": "CT",
      "parts": ["CT"],
      "treatment": "taxable",
      "rate": 0.0635,
      "rule": {
        "treatment": "conditional",
        "summary": "Remotely accessed software is taxed at 1% when a business buys it for business use, and at 6.35% otherwise.",
        "conditions": [ ... ],
        "citations": [ ... ]
      }
    }
  ],
  "interpreted": {
    "from": "text",
    "code": "software.saas",
    "confidence": 1,
    "conditions": [
      { "tax": "CT", "when": ["Bought for personal, non-business use"], "confidence": 1 }
    ]
  }
}`;

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
	every kind alike, else as conditional on its subcodes, each listed in the rule's <code>conditions</code>. Where the
	subcodes list exceptions (a few professional services a state taxes), <code>.other</code> is everything else under the code:
	<code>service.professional.other</code> is a professional service that is none of the listed kinds, and answers by the broad
	code's own rule.
</p>
<table>
	<thead><tr><th>Code</th><th>What it covers</th></tr></thead>
	<tbody>
		{#each CODES as [code, definition] (code)}
			<tr id={code}><td class={depth(code) ? 'sub' : ''}><code>{code}</code></td><td>{definition}</td></tr>
		{/each}
	</tbody>
</table>
<p>
	A price limit isn't a code. Where a state exempts clothing only below a price per item (New York under $110), or taxes only
	the part of an item's price above a limit (Massachusetts above $175, Rhode Island above $250), the <code>clothing</code> rule
	is <code>conditional</code>, and each case names the amount;
	send <code>clothing.accessories</code> or <code>clothing.equipment</code> for the kinds most clothing exemptions leave taxed.
	Alcohol is taxed in many places by a separate liquor, drink or gross receipts tax beside or instead of the sales tax: the
	answer covers the sales tax only, and the rule's summary names the other tax where there is one. The list grows only when a
	rule needs a split: medicine and digital goods each get a code when their rules are researched. A motor vehicle rental has no
	code: most places tax it apart from the sales tax.
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
<p>* The nearest code; that provider has no exact match. For alcohol each provider splits beer, wine and spirits: the beer code is shown, and its wine and spirits codes map the same way.</p>

<h2 id="coverage">Coverage</h2>
<p>
	Rules are researched for every state, DC, and every Canadian province and territory. Each one is read from the state's or agency's own statutes, regulations and bulletins, and cites the pages it came from. No state
	publishes taxability as data, so the rules are written down by hand from those pages and tested against the agencies' worked
	examples.
</p>
<p>
	Any code or date without a rule in a place answers <code>not_researched</code>. The general <code>rate</code> is
	still returned as always. <code>GET /v1/coverage</code> lists each state's <code>taxabilityCodes</code>: the codes with a
	researched rule there today.
</p>

<h2 id="treatments">Treatments</h2>
<p>Each entry's <code>treatment</code> describes the sale as a whole.</p>
<table>
	<thead><tr><th>Treatment</th><th>Meaning</th><th><code>rate</code></th></tr></thead>
	<tbody>
		<tr><td><code>taxable</code></td><td>Every part at its rate.</td><td>The combined rate</td></tr>
		<tr><td><code>partial</code></td><td>Some parts, a reduced rate, or a share of the charge: a restaurant meal in British Columbia pays GST but not PST; Texas taxes 80% of a SaaS charge.</td><td>The sum of the taxing parts</td></tr>
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
	When <code>rate</code> is a number, charge it, unless the rule's <code>conditions</code> list an exception that fits your sale
	(Kentucky taxes SaaS and interior design at 6%, except under a grandfathered lump-sum or fixed-price contract executed on or
	before February 25, 2022). A settled rule's conditions are its exceptions; read them once for each kind of sale you make. When <code>rate</code>
	is <code>null</code> and the treatment is <code>conditional</code>, pick the case in <code>outcomes</code> that fits the sale and
	charge its <code>rate</code>, or show the rules' <code>conditions</code> and let a person pick; each names its own
	<code>treatment</code> and, where a part's rate is reduced, its <code>rate</code>. When it's <code>null</code> and
	<code>not_researched</code>, send the sale to another engine or a person. Never use the general rate in its place.
</p>
<p>
	A narrower code settles only the facts the codes carry (hot or cold, legal or IT). Facts about the seller or the sale, such
	as whether a Michigan seller hands over napkins or how many servings are in the box, stay conditional whatever code you send.
</p>
<pre><code>{CONDITIONAL}</code></pre>
<p>
	A sandwich to go in Los Angeles is conditional: hot, it's taxed; cold, it isn't, unless the seller falls under California's 80-80
	rule. The code can't say which, so the answer lists each case (shortened above; the API returns each condition in full).
</p>

<h3 id="outcomes">Outcomes</h3>
<p>
	A conditional answer carries <code>outcomes</code>: each case with the sale's combined <code>rate</code> in it, and the narrower
	<code>code</code> where a case is one (send it instead to get the answer settled). Where only one tax is undecided, each
	outcome is one of its conditions plus the taxes that are settled.
</p>
<p>
	Where several taxes are undecided (a state and its local tax, or GST and PST), their cases are combined only where they describe
	the same sale: the two rules state the case in the same words (one may add a further fact, after a semicolon), or the cases are
	the same narrower code. Take-and-bake pizza in Montpelier, Vermont has four outcomes: a whole uncooked pizza (0%), other
	prepackaged food to cook (0%), and a taxable meal in a town with or without the local meals tax (10% or 9%). A whole pizza is
	never paired with a taxable meal.
</p>
<p>
	Where the taxes' cases don't pair up, the answer has <code>independent: true</code>: the taxes turn on their facts
	independently, so combine one case per tax. Each outcome is then one tax's case, named in its <code>tax</code> and prefixed to
	its <code>when</code> (<code>"BC:PST: ..."</code>), with that case's rate for its tax plus the settled taxes'. The sale's rate is
	the settled taxes' rate plus, for each undecided tax, its chosen case's rate less the settled taxes'. Where no tax is settled,
	add the chosen cases' rates.
</p>

<h2 id="describe">Describing the sale in plain words</h2>
<p>
	With an API key, send <code>describe</code> with what was sold, as you'd write it on a receipt line: one item, up to 200 characters. A model
	(TypeSafe's Jev) reads it, but only to pick among options it's offered, in their own words: which code's definition the
	words establish, and which of a rule's own <code>conditions</code> they describe, or that they don't say. It never sees a
	rate, a treatment, the address or the date, and the rules decide the tax exactly as they do for <code>code</code>.
</p>
<pre><code>{DESCRIBE_LINE}</code></pre>
<pre><code>{DESCRIBE_RESPONSE}</code></pre>
<ul>
	<li>
		<strong>Alone</strong>, the entry is keyed by the text. A confident code answers; where the words fit a broad code but not
		which kind, the broader code answers (<code>food.prepared</code>, not a guess at hot or cold). A code whose definition turns
		on a fact answers only where the words establish it, by saying so or naming something that has it by definition: ginger
		ale is a soft drink, but an iced tea isn't known to be sweetened. Otherwise a broader code whose fact they do establish
		answers, or the candidates do, and <code>interpreted.unestablished</code> names the code. Send one item per line: where
		the words name several different items, a code answers only if every item is of it (milk, eggs and bread are groceries);
		otherwise the answer is <code>conditional</code> with <code>needs: ["one_item"]</code>. Where they could be several
		codes, the answer is <code>conditional</code>, <code>interpreted.code</code> is <code>null</code> and
		<code>candidates</code> lists them: send one as <code>code</code>. Where no code covers it (a haircut), it's
		<code>not_researched</code>.
	</li>
	<li>
		<strong>Beside one code</strong>, the code answers as sent, keyed by the code; the text only settles that code's cases. If
		the words point to a different code, <code>interpreted.mismatch</code> is <code>true</code> and none of the code's cases is
		settled from them: check the code.
	</li>
	<li>
		<strong>The cases.</strong> Where a rule is conditional, a case the words establish settles that tax, at the rate the
		matching outcome gives, and <code>interpreted.conditions</code> names it. A case the words don't settle stays open: the
		answer stays <code>conditional</code> with its outcomes. Silence settles nothing: a case that states a fact by its absence
		(sold without eating utensils) is settled only where the words say so. Where a settled rule lists exceptions (a napkin in the box makes a
		Michigan bakery item taxable), an exception the words establish applies, and one they make likely without establishing
		makes the answer conditional instead.
	</li>
	<li>
		<strong>Facts a description can't carry.</strong> A price or a count in the words is never taken as the sale's, and a
		case that turns on the seller's share of prepared-food sales, the place's own local taxes, payment in a dated tax period or
		when title passed is never settled from words either. Such a case stays open, and <code>needs</code> names the facts:
		<code>seller_kind</code>, <code>locality</code>, <code>payment_date</code>, <code>title_transfer</code>,
		<code>qualifying_total</code>, <code>contract_total</code>, <code>quantity_by_kind</code>, <code>code</code> when no one
		code fits, or <code>one_item</code> when the words name several items that aren't all of one code. A count only blocks the cases it decides: a loaf of bread is settled by its case's "bread products" alternative,
		not held open by the same case's "six or more single servings". Which local taxes the address's place levies is never
		asked of you: where our rules don't have that place's local law yet, <code>unresearched: ["locality"]</code> says so.
	</li>
	<li>
		<strong>Failures.</strong> If the model can't be asked or fails, the entry answers as if no text was sent, with
		<code>interpreted.unavailable: true</code>; the general rate always answers.
	</li>
</ul>
<p>
	A confidence is a model signal, not proof: thresholds tuned on the agencies' worked examples decide what is used, set so
	that none of them comes out wrong. Name the facts that matter (hot or cold, who sold it, for personal or business use) and
	more answers settle.
</p>

<h3 id="base">A share of the charge</h3>
<p>
	Some laws tax only part of a charge. Texas taxes 80% of a data processing or information service charge, SaaS included, so
	at 8.25% the tax is 6.6% of the full price. Such a rule, or one of its conditions, carries <code>base</code>: the share taxed
	(<code>0.8</code>). The answer's <code>rate</code>, the parts' <code>rate</code> and every outcome already apply it, on the
	whole charge: charge <code>rate</code> on the full price and don't reduce the amount as well. An answer taxed on a share is
	<code>partial</code>.
</p>

<style>
	.sub {
		padding-left: 1.75rem;
	}
</style>
