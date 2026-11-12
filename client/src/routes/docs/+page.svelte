<script lang="ts">
	import { GITHUB } from '$lib/examples';
	import RateTryIt from '$lib/docs/RateTryIt.svelte';
	import TryIt from '$lib/docs/TryIt.svelte';

	const RESPONSE = `{
  "state": "WA",
  "rate": 0.1055,
  "stateRate": 0.065,
  "localRate": 0.0405,
  "byType": {
    "general": 0.1055,
    "generalInterstate": 0.1055,
    "foodDrug": 0.1055,
    "foodDrugInterstate": 0.1055
  },
  "parts": [
    { "kind": "state", "name": "Washington", "code": "45:53", "rate": 0.065, "ids": {} },
    { "kind": "city", "name": "Seattle", "code": "01:63000", "rate": 0.0405, "ids": {} }
  ],
  "match": "street",
  "locationCode": "53-000-63000",
  "jurisdictions": "settled",
  "alternatives": [],
  "locationIds": { "Composite SER Code": "01726", "Location Code": "1726" },
  "zip4": "98109-4607",
  "source": "Streamlined Sales Tax files WAB2026Q4AUG27 + WAR2026Q4AUG27, street match on 2026-10-22",
  "reporting": {
    "agency": { "name": "Washington Department of Revenue", "url": "https://dor.wa.gov/..." },
    "form": "Combined Excise Tax Return",
    "notes": []
  }
}`;

	const LINE = `GET /v1/rate?address=1410+E+Pine+St,+Seattle,+WA+98122`;
	const FIELDS = `GET /v1/rate?state=WA&street=1410+E+Pine+St&city=Seattle&zip=98122`;

	const TAX_LINE = `GET /v1/rate?address=488+14th+St,+Brooklyn,+NY+11215&date=2026-10-08&code=food.catering,food.grocery`;

	const TAX_RESPONSE = `{
  "state": "NY",
  "rate": 0.08875,
  "parts": [
    { "kind": "state", "name": "New York", "code": "45:36", "rate": 0.04, "ids": {} },
    { "kind": "county", "name": "Kings", "code": "00:047", "rate": 0.04875, "ids": {} }
  ],
  ...
  "taxability": {
    "food.catering": {
      "treatment": "taxable",
      "rate": 0.08875,
      "taxes": [
        {
          "tax": "NY",
          "parts": ["45:36", "00:047"],
          "treatment": "taxable",
          "rate": 0.08875,
          "rule": {
            "summary": "A caterer's entire charge for a customer's event is taxable, including food, beverages, staff, rentals, room charges and service charges, even when separately stated.",
            "from": "2019-04-08",
            "fromIs": "earliest_verified",
            "treatment": "taxable",
            "conditions": [],
            "citations": [
              {
                "title": "TB-ST-110 (issued April 8, 2019)",
                "url": "https://www.tax.ny.gov/pubs_and_bulls/tg_bulletins/st/caterers_and_catering_services.htm"
              }
            ]
          }
        }
      ]
    },
    "food.grocery": {
      "treatment": "not_taxed",
      "rate": 0,
      "taxes": [
        {
          "tax": "NY",
          "parts": ["45:36", "00:047"],
          "treatment": "exempt",
          "rate": 0,
          "rule": { "summary": "Unprepared food for home consumption sold by food stores is exempt from state and local sales tax under Tax Law §1115(a)(1).", ... }
        }
      ]
    }
  }
}`;

	const READ = `const t = answer.taxability[code];
if (t.rate !== null) charge(amount * t.rate);          // taxable, partial, not_taxed: unless a rule's conditions list an exception that fits
else if (t.treatment === 'conditional') ask(t.outcomes); // each case with its rate (one per tax when t.independent); send o.code where there is one
else sendElsewhere();                                   // not_researched: never use the general rate`;

	const ERROR = `{ "error": "This address is within 12 m of a city line ...", "code": "ADDRESS_NEEDS_CONFIRMATION" }`;
</script>

<svelte:head>
	<title>API reference · OpenTaxRate Docs</title>
	<meta name="description" content="The OpenTaxRate API: look up the sales tax rate at a US address, split into the taxes that make it up." />
</svelte:head>

<h1 id="intro">API reference</h1>
<p class="lead">
	One call gives the sales tax rate at a US street address, split into the state, county, city and district taxes that make it
	up. Every answer comes from the state's own published data; when that can't place an address in one rate, the API refuses
	with the reason instead of guessing.
</p>

<table>
	<tbody>
		<tr><td>Base URL</td><td><code>https://api.opentaxrate.com</code></td></tr>
		<tr>
			<td>Auth</td>
			<td>
				<code>Authorization: Bearer &lt;key&gt;</code> or <code>x-api-key: &lt;key&gt;</code>. Create keys in the
				<a class="link" href="/dashboard/keys">dashboard</a>; lookups are paid from your credit (<a class="link" href="/pricing">pricing</a>), 300 a minute per key.
			</td>
		</tr>
		<tr>
			<td>Without a key</td>
			<td>
				Free, 10 lookups a minute and 300 a day per IP address. Addresses are placed only by the geocoders we host
				(Pelias and Photon, built from open address data). When neither can place one, the API answers only if its whole
				ZIP has one rate, and declines otherwise.
			</td>
		</tr>
		<tr>
			<td>With a key</td>
			<td>
				The same data and rules, plus commercial geocoders as further witnesses, so fewer addresses are declined or
				answered from the ZIP alone.
			</td>
		</tr>
		<tr><td>Rates</td><td>Decimals: <code>0.1055</code> is 10.55%.</td></tr>
		<tr>
			<td>OpenAPI</td>
			<td>
				<a class="link" href="https://api.opentaxrate.com/v1/openapi.json" target="_blank" rel="noopener"
					><code>/v1/openapi.json</code></a
				>, for generating a client or importing into Postman.
			</td>
		</tr>
	</tbody>
</table>

<h2 id="rate">GET /v1/rate</h2>
<p>The rate at an address on a given day.</p>
<RateTryIt />

<h3 id="parameters">Parameters</h3>
<p>Give the address one of two ways. Both answer the same; with both, the fields win over the line.</p>
<pre><code>{LINE}</code></pre>
<pre><code>{FIELDS}</code></pre>
<table>
	<thead><tr><th>Name</th><th>Description</th></tr></thead>
	<tbody>
		<tr class="group"><td colspan="2">As one line</td></tr>
		<tr>
			<td><code>address</code></td>
			<td>
				The whole address: <code>1410 E Pine St, Seattle, WA 98122</code>. Commas are optional; the state can be a code or its name;
				the ZIP is optional. A line that can't be read is a 400 saying what's missing.
			</td>
		</tr>
		<tr class="group"><td colspan="2">Or as fields</td></tr>
		<tr><td><code>state</code></td><td>Two-letter state code. Required without <code>address</code>.</td></tr>
		<tr><td><code>street</code></td><td>House number and street, e.g. <code>1410 E Pine St</code>.</td></tr>
		<tr><td><code>city</code></td><td>City name.</td></tr>
		<tr><td><code>zip</code></td><td>Five digits or ZIP+4. Recommended in either form: without it the address is geocoded, and a few more are refused.</td></tr>
		<tr class="group"><td colspan="2">Either way</td></tr>
		<tr><td><code>date</code></td><td><code>YYYY-MM-DD</code>; today when absent.</td></tr>
		<tr>
			<td><code>code</code></td>
			<td>
				What was sold, one or more <a class="link" href="/docs/taxability">taxability codes</a> separated by commas:
				<code>food.catering,food.grocery</code>. Adds <a class="link" href="#taxability"><code>taxability</code></a>, one entry
				per code. An unknown code is a 400 listing the valid ones.
			</td>
		</tr>
		<tr>
			<td><code>describe</code></td>
			<td>
				What was sold in plain words, one item, up to 200 characters: <code>hot rotisserie chicken</code>. Alone, it adds one
				<code>taxability</code> entry keyed by the text; beside one <code>code</code>, the code answers and the text settles the
				rules' cases. A model only picks among the codes and the rules' own cases; the rules decide, and a case that turns on an amount or a count of units stays open. See
				<a class="link" href="/docs/taxability#describe">Describing the sale</a>. Beside two or more codes it is a 400. Needs an API key: without one it is a 403 (<code>KEY_REQUIRED</code>).
			</td>
		</tr>
		<tr>
			<td><code>include</code></td>
			<td>
				<code>trace</code> adds placement evidence; <code>regions</code> adds
				<a class="link" href="/docs/regions">regional data</a>. Combine as <code>trace,regions</code>.
			</td>
		</tr>
	</tbody>
</table>

<h3 id="response">Response</h3>
<pre><code>{RESPONSE}</code></pre>
<table>
	<thead><tr><th>Field</th><th>Description</th></tr></thead>
	<tbody>
		<tr><td><code>rate</code></td><td>The general rate: the combined rate on a general sale of goods. It isn't the rate on any particular kind of sale; with <code>code</code>, each sale's own rate is <code>taxability[code].rate</code>.</td></tr>
		<tr><td><code>stateRate</code>, <code>localRate</code></td><td>The state's part, and everything else.</td></tr>
		<tr>
			<td><code>byType</code></td>
			<td>
				The address's rate tables by type of sale, as the state's files publish them: <code>general</code>,
				<code>generalInterstate</code>, <code>foodDrug</code> (a state's food rate) and <code>foodDrugInterstate</code>;
				<code>null</code> where the state publishes none. They are not this sale's taxability: Seattle's <code>foodDrug</code> is
				10.55% though groceries are exempt there. For what a sale is taxed, send <code>code</code> and read
				<code>taxability[code].rate</code>.
			</td>
		</tr>
		<tr><td><code>parts</code></td><td>Each tax adding up to <code>rate</code>: <code>kind</code> (<code>state</code>, <code>county</code>, <code>city</code>, <code>district</code>), <code>name</code>, <code>code</code> (the publisher's type and code, e.g. <code>01:63000</code>), <code>rate</code>, <code>byType</code>, <code>classRates</code> (the part's own rate on restaurant meals or groceries where its state's table rates them apart, as Arizona's cities do; absent otherwise, never the general rate in its place), <code>classCases</code> (where that rate turns on a fact the address doesn't settle, each case and its rate: an Illinois Metro East location's grocery rate, for a retailer liable for the district's tax or not; a sale taxed at it is then conditional on the cases) and <code>ids</code>.</td></tr>
		<tr>
			<td><code>match</code></td>
			<td>
				How the address was placed: <code>statewide</code>, <code>street</code>, <code>zip4</code>, <code>zip5</code>, <code>map</code>
				(geocoded into outlines), <code>zip_area</code> (the whole ZIP has one rate) or <code>authority</code> (the state's own lookup).
			</td>
		</tr>
		<tr><td><code>locationCode</code></td><td>Our identifier for the combination of taxes. Not a filing code.</td></tr>
		<tr>
			<td><code>jurisdictions</code>, <code>alternatives</code></td>
			<td>
				Whether <code>parts</code> name the jurisdictions the tax is paid to. The rate is settled either way; <code>uncertain</code> where
				the address could be in another combination of jurisdictions with the same total, each listed in <code>alternatives</code>
				as <code>{"{ locationCode, parts }"}</code>, or the state's own lookup gave one local part for every local tax.
			</td>
		</tr>
		<tr><td><code>locationIds</code>, <code>parts[].ids</code></td><td>The state's own codes, as published. See <a class="link" href="/docs/codes">State codes and filing</a>.</td></tr>
		<tr><td><code>zip4</code></td><td>The address's ZIP+4 where a Streamlined state's files give it; else <code>null</code>.</td></tr>
		<tr><td><code>source</code></td><td>The files or service the rate came from, and the date. See <a class="link" href="#old-files">why some source files are old</a>.</td></tr>
		<tr><td><code>reporting</code></td><td>The agency, return, and any local filing. See <a class="link" href="/docs/codes#reporting">Reporting</a>.</td></tr>
		<tr><td><code>taxability</code></td><td>With <code>code</code>: how each code asked is taxed here, keyed by the code. With <code>describe</code> and no code: one entry keyed by the text as sent. See <a class="link" href="#taxability">Taxability</a>.</td></tr>
		<tr><td><code>regions</code></td><td>With <code>include=regions</code>. See <a class="link" href="/docs/regions">Regional data</a>.</td></tr>
	</tbody>
</table>

<h3 id="old-files">Why some source files are old</h3>
<p>
	A state publishes a new rate file only when a rate or a boundary changes. A state with one rate everywhere and no local sales
	taxes may go years without one: Kentucky's 6% is the same at every address, so its Streamlined files from 2012 and 2013
	(<code>KYR2012Q4Aug13</code>, <code>KYB2013Q2MAR13</code>) are still the current ones. The date in a file's name is when the
	state published it, not when OpenTaxRate last checked for a newer one.
</p>

<h3 id="taxability">Taxability</h3>
<p>
	Name what was sold with <code>code</code> and the answer says whether that sale is taxed at the address on the date, at what
	rate, and the government page that says so. The general <code>rate</code> and <code>parts</code> don't change. Rules are
	researched for every state, DC, and every Canadian province and territory; a code without a rule in that place answers
	<code>not_researched</code>. See <a class="link" href="/docs/taxability">Taxability codes</a> for the
	codes and what each covers.
</p>
<pre><code>{TAX_LINE}</code></pre>
<pre><code>{TAX_RESPONSE}</code></pre>
<p>Read each entry in three lines. When <code>rate</code> is <code>null</code>, never charge the general rate instead.</p>
<pre><code>{READ}</code></pre>
<table>
	<thead><tr><th>Field</th><th>Description</th></tr></thead>
	<tbody>
		<tr>
			<td><code>treatment</code></td>
			<td>
				The sale as a whole: <code>taxable</code> (every part at its rate), <code>partial</code> (some parts, or a reduced rate),
				<code>not_taxed</code> (no part), <code>conditional</code> (it turns on facts the code doesn't fix) or
				<code>not_researched</code> (a part has no researched rule for this code on this date).
			</td>
		</tr>
		<tr><td><code>rate</code></td><td>The combined rate to charge on this sale, unless the rules' <code>conditions</code> list an exception that fits it (e.g. Kentucky's grandfathered fixed-price contracts); <code>null</code> exactly when <code>conditional</code> or <code>not_researched</code>.</td></tr>
		<tr><td><code>taxes[].tax</code></td><td>What the rule covers: a state (every part there), its local parts (<code>CO:local</code>), one local part, named by its code in <code>parts</code>, where that city or county sets its own taxability or rate (<code>CO:local:01:ttr17</code>, Denver's city tax), the state part with the local taxes the state administers but not a self-collected home-rule city's (<code>CO:administered</code>), <code>CA:GST/HST</code>, a province's HST change (<code>ON/CA:HST</code>), a provincial tax (<code>BC:PST</code>), or <code>*</code> for a <code>nontaxable</code> line.</td></tr>
		<tr><td><code>taxes[].parts</code></td><td>The <code>code</code>s of the answer's parts this rule decides; together the entries cover every part once.</td></tr>
		<tr>
			<td><code>taxes[].treatment</code></td>
			<td>
				The legal treatment: <code>taxable</code>, <code>exempt</code>, <code>zero_rated</code>, <code>conditional</code>,
				<code>not_a_sale</code> or <code>not_researched</code>. Exempt and zero-rated both mean no tax, but a Canadian return
				reports them on different lines.
			</td>
		</tr>
		<tr><td><code>taxes[].rate</code></td><td>What these parts add to the sale's rate; <code>null</code> when conditional or not researched.</td></tr>
		<tr><td><code>taxes[].rule</code></td><td>The rule that decided them; <code>null</code> only when not researched.</td></tr>
		<tr>
			<td><code>rule.from</code>, <code>rule.to</code>, <code>rule.fromIs</code></td>
			<td>
				The days the rule answers for; no <code>to</code> means still in force. <code>effective</code>: <code>from</code> is the day
				it took effect. <code>earliest_verified</code>: it's likely older, but earlier dates aren't researched and answer
				<code>not_researched</code>.
			</td>
		</tr>
		<tr><td><code>rule.summary</code>, <code>rule.treatment</code></td><td>The rule in one sentence, and what it decides.</td></tr>
		<tr>
			<td><code>rule.base</code></td>
			<td>
				Where the law taxes only a share of the charge, that share (<code>0 &lt; base &lt; 1</code>): Texas taxes 80% of a SaaS or
				data processing charge, <code>0.8</code>. Every rate in the answer already applies it, on the whole charge (6.6% of the
				price where the general rate is 8.25%), so don't reduce the amount as well. Absent: the whole charge is taxed.
			</td>
		</tr>
		<tr>
			<td><code>rule.rateClass</code></td>
			<td>
				On a <code>special_rate</code> rule in place of <code>rate</code>: each part is taxed at its own rate for this class,
				its <code>classRates</code> entry (<code>restaurant</code> or <code>grocery</code>). Dine-in food in Glendale, Arizona is taxed at
				the city's 3.9% restaurant rate, 10.2% in all, against 9.2% on a general sale. A part with no rate for the class is not researched.
			</td>
		</tr>
		<tr><td><code>rule.conditions</code></td><td>For a conditional rule, each fact the outcome turns on: <code>{'{ when, treatment, rate?, rateClass?, base?, code? }'}</code>; <code>base</code> is the share taxed in that case, <code>code</code> the narrower code that case is. For a settled one, its exceptions: the rule's <code>rate</code> holds unless one of them fits the sale.</td></tr>
		<tr>
			<td><code>outcomes</code></td>
			<td>
				Only when <code>conditional</code>: each case with the sale's combined rate, <code>{'{ when, rate, code?, tax? }'}</code>.
				Where <code>code</code> is set, sending that code instead settles the answer at that rate. Where several taxes are
				undecided, their cases are combined only where they describe the same sale (stated in the same words, or the same
				narrower code), never a case of one with a contradicting case of the other.
			</td>
		</tr>
		<tr>
			<td><code>independent</code></td>
			<td>
				<code>true</code> where several taxes are undecided and their cases don't pair up: the taxes turn on their facts
				independently; combine one case per tax. Each outcome is then one tax's case, named in its <code>tax</code>, at that case's
				rate for its tax plus the settled taxes'. The sale's rate is the settled taxes' plus each chosen case's own share. See
				<a class="link" href="/docs/taxability#outcomes">Outcomes</a>.
			</td>
		</tr>
		<tr>
			<td><code>interpreted</code></td>
			<td>
				Only with <code>describe</code>: how the text was read. <code>code</code> is the code it points to (with the model's
				<code>confidence</code>), <code>null</code> with <code>candidates</code> when it could be several;
				<code>conditions</code> lists the rules' cases the text settled, one per tax; <code>mismatch</code> is <code>true</code>
				when the text points away from the code sent (the code still answers); <code>unavailable</code> is <code>true</code> when
				the text couldn't be read, and the entry answers as without it. See
				<a class="link" href="/docs/taxability#describe">Describing the sale</a>.
			</td>
		</tr>
		<tr><td><code>rule.citations</code></td><td>The official pages the rule was read from: <code>title</code>, <code>url</code> (the page as published), the <code>quote</code> the rule rests on, and <code>archived</code>: OpenTaxRate's copy of the page that shows the quote, opening at the sentence, pinned to its <code>sha256</code>. Link to <code>archived</code>; it names the original too.</td></tr>
	</tbody>
</table>

<h3 id="errors">Errors</h3>
<pre><code>{ERROR}</code></pre>
<table>
	<thead><tr><th>Status</th><th>Code</th><th>Meaning</th></tr></thead>
	<tbody>
		<tr><td>400</td><td><code>BAD_REQUEST</code></td><td>A parameter failed validation, or <code>address</code> couldn't be read; the message says what's missing.</td></tr>
		<tr><td>401</td><td><code>INVALID_API_KEY</code></td><td>The key isn't one we issued.</td></tr>
		<tr><td>402</td><td><code>NO_CREDITS</code></td><td>The key's credit doesn't cover the lookup.</td></tr>
		<tr><td>422</td><td><code>ADDRESS_NEEDS_CONFIRMATION</code></td><td>The data can't place the address in one rate; the message says why.</td></tr>
		<tr><td>422</td><td><code>UNSUPPORTED_STATE</code></td><td>No rates for this state yet.</td></tr>
		<tr><td>429</td><td><code>RATE_LIMITED</code>, <code>KEY_LIMITED</code></td><td>Too many lookups; wait the <code>Retry-After</code> seconds.</td></tr>
		<tr><td>502</td><td><code>UPSTREAM_UNAVAILABLE</code></td><td>A state's data isn't loaded, or its service is down.</td></tr>
		<tr><td>504</td><td><code>UPSTREAM_TIMEOUT</code></td><td>A state's service timed out.</td></tr>
	</tbody>
</table>

<h2 id="coverage">GET /v1/coverage</h2>
<p>
	Each state, how its addresses are placed, the files loaded for it, and its registered <code>regionSources</code>. See
	<a class="link" href="/sources">Sources</a> for where each state's data comes from, or
	<a class="link" href="{GITHUB}#quick-start" target="_blank" rel="noopener">run the API yourself</a>.
</p>
<TryIt path="/v1/coverage" />

<style>
	.group td {
		padding-top: 1.25rem;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
</style>
