<script lang="ts">
	import { GITHUB } from '$lib/examples';
	import SiteFooter from '$lib/landing/SiteFooter.svelte';
	import SiteNav from '$lib/landing/SiteNav.svelte';

	const SECTIONS = [
		{ id: 'intro', title: 'Introduction' },
		{ id: 'quickstart', title: 'Quick start' },
		{ id: 'auth', title: 'API keys' },
		{ id: 'rate', title: 'Look up a rate' },
		{ id: 'response', title: 'The response' },
		{ id: 'parts', title: 'Parts' },
		{ id: 'ids', title: "States' own codes" },
		{ id: 'reporting', title: 'Reporting' },
		{ id: 'errors', title: 'Errors' },
		{ id: 'coverage', title: 'Coverage' }
	];

	const CURL = `curl "https://api.opentaxrate.com/v1/rate?state=WA&street=1410+E+Pine+St&city=Seattle&zip=98122" \\
  -H "Authorization: Bearer otr_live_..."`;

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
  "locationIds": { "Composite SER Code": "01726" },
  "source": "Streamlined Sales Tax files WAB2026Q4AUG27 + WAR2026Q4AUG27, street match on 2026-10-22",
  "reporting": {
    "agency": { "name": "Washington Department of Revenue", "url": "https://dor.wa.gov/..." },
    "form": "Combined Excise Tax Return",
    "notes": []
  }
}`;

	const ALABAMA = `"parts": [
  { "kind": "state", "name": "Alabama", "code": "45:01", "rate": 0.04, "ids": {} },
  { "kind": "county", "name": "MONTGOMERY COUNTY", "code": "00:101", "rate": 0.025,
    "ids": { "Locality Code": "7051", "County Number": "51", "Administered": "SELF" } },
  { "kind": "city", "name": "MONTGOMERY", "code": "01:51000", "rate": 0.035,
    "ids": { "Locality Code": "9454", "County Number": "51", "Administered": "SELF" } }
]`;

	const ERROR = `{ "error": "This address is within 12 m of a city line ...", "code": "ADDRESS_NEEDS_CONFIRMATION" }`;
</script>

<svelte:head>
	<title>Docs · OpenTaxRate</title>
	<meta name="description" content="The OpenTaxRate API: look up the sales tax rate at a US address, its parts, and each state's own codes for them." />
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<SiteNav />

	<div class="mx-auto flex w-full max-w-[1100px] flex-1 gap-12 px-5 pt-10 pb-20 sm:px-8">
		<nav class="sticky top-[96px] hidden h-fit w-44 shrink-0 text-sm md:block" aria-label="On this page">
			<p class="mb-3 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">API</p>
			<ul class="flex flex-col gap-2">
				{#each SECTIONS as s (s.id)}
					<li><a class="text-[var(--text-2)] hover:text-[var(--text)]" href="#{s.id}">{s.title}</a></li>
				{/each}
			</ul>
		</nav>

		<main class="docs min-w-0 flex-1">
			<h1 id="intro" class="text-[34px] leading-tight font-semibold tracking-tight">OpenTaxRate API</h1>
			<p class="lead">
				One call gives the sales tax rate at a US street address, split into the state, county, city and district taxes that make
				it up, each with the state's own codes for it.
			</p>
			<p>
				Every answer comes from the state's own published data. When the data can't place an address in a single rate, the API
				refuses with the reason rather than guessing.
			</p>

			<h2 id="quickstart">Quick start</h2>
			<pre><code>{CURL}</code></pre>
			<p>Without a key, lookups are limited per IP address. Rates are decimals: <code>0.1055</code> is 10.55%.</p>

			<h2 id="auth">API keys</h2>
			<p>
				Create a key in the <a class="link" href="/dashboard/keys">dashboard</a> and send it as <code>Authorization: Bearer &lt;key&gt;</code>
				or <code>x-api-key: &lt;key&gt;</code>. Keyed calls go to <code>api.opentaxrate.com</code> and are paid from your credit (see
				<a class="link" href="/pricing">pricing</a>). Each key can make 120 lookups a minute.
			</p>

			<h2 id="rate">Look up a rate</h2>
			<p><code>GET /v1/rate</code></p>
			<table>
				<thead><tr><th>Parameter</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>state</code></td><td>Two-letter state code. Required.</td></tr>
					<tr><td><code>street</code></td><td>House number and street, e.g. <code>1410 E Pine St</code>.</td></tr>
					<tr><td><code>city</code></td><td>City name.</td></tr>
					<tr><td><code>zip</code></td><td>Five digits or ZIP+4. Recommended: without it, the address is placed by geocoding, and a few more are refused.</td></tr>
					<tr><td><code>date</code></td><td><code>YYYY-MM-DD</code>. The rate on that day; today when absent.</td></tr>
					<tr><td><code>include</code></td><td><code>trace</code> adds how the address was placed: geocoder points, the outlines tested, the street range used.</td></tr>
				</tbody>
			</table>

			<h2 id="response">The response</h2>
			<pre><code>{RESPONSE}</code></pre>
			<table>
				<thead><tr><th>Field</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>rate</code></td><td>The combined rate on a general sale.</td></tr>
					<tr><td><code>stateRate</code>, <code>localRate</code></td><td>The state's part, and everything else.</td></tr>
					<tr><td><code>byType</code></td><td>The rate on other kinds of sale where the state's files give them: from out of state, and food and drugs. <code>null</code> where the state doesn't publish one.</td></tr>
					<tr><td><code>parts</code></td><td>Each tax that adds up to <code>rate</code>. See <a class="link" href="#parts">Parts</a>.</td></tr>
					<tr>
						<td><code>match</code></td>
						<td>
							How the address was placed: <code>statewide</code> (one rate), <code>street</code> (street range), <code>zip4</code>,
							<code>zip5</code> (every range in the ZIP agrees), <code>map</code> (county, city and district outlines), or
							<code>authority</code> (the state's own lookup).
						</td>
					</tr>
					<tr><td><code>locationCode</code></td><td>Our own identifier for the combination of taxes (state, county, city FIPS; California's tax area code). Not a filing code.</td></tr>
					<tr><td><code>locationIds</code></td><td>The state's own ids for the whole location, where its data gives one: Washington's location code as <code>{'{"Composite SER Code": "01726"}'}</code>, Missouri's <code>Jurisdiction Code</code>. <code>{'{}'}</code> otherwise, or when the address could be in areas whose ids differ. See <a class="link" href="#ids">States' own codes</a>.</td></tr>
					<tr><td><code>source</code></td><td>The files or service the rate came from, and the date.</td></tr>
					<tr><td><code>reporting</code></td><td>Who you file with. See <a class="link" href="#reporting">Reporting</a>.</td></tr>
				</tbody>
			</table>

			<h2 id="parts">Parts</h2>
			<table>
				<thead><tr><th>Field</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>kind</code></td><td><code>state</code>, <code>county</code>, <code>city</code> or <code>district</code>.</td></tr>
					<tr><td><code>name</code></td><td>The jurisdiction's name as the state's data writes it (<code>MONTGOMERY COUNTY</code>), else the Census outline's, or <code>null</code> where no published source names it (many special districts).</td></tr>
					<tr>
						<td><code>code</code></td>
						<td>
							The publisher's type and code, as in its files: <code>01:63000</code> is a city (type 01) with Census place code 63000.
							Texas parts carry the Comptroller's local codes, New Mexico's its GRT location codes. Unique within a response.
						</td>
					</tr>
					<tr><td><code>rate</code></td><td>This part's rate.</td></tr>
					<tr><td><code>byType</code></td><td>This part's rate by kind of sale, where its file gives one.</td></tr>
					<tr><td><code>ids</code></td><td>The state's own ids for this tax: see <a class="link" href="#ids">States' own codes</a>. <code>{'{}'}</code> where its data gives none.</td></tr>
				</tbody>
			</table>

			<h2 id="ids">States' own codes</h2>
			<p>
				Each part's <code>ids</code> repeats what the state's own rate data says about that tax: its codes, and who collects it.
				Keys are the publisher's own column names and values are exactly as published, leading zeros and all. We don't rename,
				reformat or check them against a return's code list, so match them to your return yourself. A Census FIPS code is never
				given as an id; it's already in <code>code</code>.
			</p>
			<pre><code>{ALABAMA}</code></pre>
			<table>
				<thead><tr><th>State</th><th>Keys in <code>ids</code></th></tr></thead>
				<tbody>
					<tr><td>Alabama</td><td><code>Locality Code</code>, <code>County Number</code>, <code>Administered</code> (<code>STATE</code>, <code>SELF</code> or a private collector). A county rate made of several codes lists each, comma-separated.</td></tr>
					<tr><td>Texas</td><td><code>TAID</code>; <code>CMPTRL_CNTY_NBR</code> and <code>FIPS_ST_CNTY_CD</code> for counties, <code>Transit_Type</code>, <code>SPD_Type</code></td></tr>
					<tr><td>Illinois</td><td><code>Location Code</code> with its check digit (<code>048-0002-8</code>), <code>County Name</code></td></tr>
					<tr><td>Louisiana</td><td><code>Domicile Code</code>, <code>Parish</code>, <code>Parish Code</code></td></tr>
					<tr><td>Arizona</td><td><code>RegionCode</code>, and <code>County</code> or <code>FIPS</code></td></tr>
					<tr><td>New Mexico</td><td><code>locat_cdr</code>, <code>locat_cd1</code>, <code>locat_cd2</code></td></tr>
					<tr><td>Colorado, Alaska</td><td><code>placeId</code>, <code>placeTypeId</code> (the state lookup's own ids)</td></tr>
					<tr><td>Missouri</td><td><code>Jurisdiction Code</code>, <code>District Code 1</code> to <code>5</code>; the location's <code>Jurisdiction Code</code> is also in <code>locationIds</code></td></tr>
					<tr><td>Streamlined states (WA, KS, OH, GA, ...)</td><td>None on parts; the location's <code>Composite SER Code</code> in <code>locationIds</code> where the state fills it (Washington's is its location code, zero-padded: <code>01726</code> is location 1726)</td></tr>
					<tr><td>Everywhere else</td><td>None yet: <code>{'{}'}</code></td></tr>
				</tbody>
			</table>

			<h2 id="reporting">Reporting</h2>
			<p>
				<code>reporting</code> says where the tax is filed. The codes the return asks for are each part's <code>ids</code> and the
				answer's <code>locationIds</code>.
			</p>
			<table>
				<thead><tr><th>Field</th><th>Description</th></tr></thead>
				<tbody>
					<tr><td><code>agency</code></td><td>The state agency the return goes to, and its sales tax page.</td></tr>
					<tr><td><code>form</code></td><td>The return most sellers file there.</td></tr>
					<tr><td><code>notes</code></td><td>Filing that doesn't go through the state: cities that collect their own tax, a separate program for remote sellers.</td></tr>
				</tbody>
			</table>

			<h2 id="errors">Errors</h2>
			<pre><code>{ERROR}</code></pre>
			<table>
				<thead><tr><th>Status</th><th>Code</th><th>Meaning</th></tr></thead>
				<tbody>
					<tr><td>400</td><td><code>BAD_REQUEST</code></td><td>A parameter failed validation.</td></tr>
					<tr><td>401</td><td><code>INVALID_API_KEY</code></td><td>The key isn't one we issued.</td></tr>
					<tr><td>402</td><td><code>NO_CREDITS</code></td><td>The key's credit doesn't cover the lookup.</td></tr>
					<tr><td>422</td><td><code>ADDRESS_NEEDS_CONFIRMATION</code></td><td>The data can't place the address in one rate; the message says why.</td></tr>
					<tr><td>422</td><td><code>UNSUPPORTED_STATE</code></td><td>No rates for this state yet.</td></tr>
					<tr><td>429</td><td><code>RATE_LIMITED</code>, <code>KEY_LIMITED</code></td><td>Too many lookups; wait the <code>Retry-After</code> seconds.</td></tr>
					<tr><td>502</td><td><code>UPSTREAM_UNAVAILABLE</code></td><td>A state's data isn't loaded, or its service is down.</td></tr>
					<tr><td>504</td><td><code>UPSTREAM_TIMEOUT</code></td><td>A state's service timed out.</td></tr>
				</tbody>
			</table>

			<h2 id="coverage">Coverage</h2>
			<p>
				<code>GET /v1/coverage</code> lists each state, how its addresses are placed, and the files loaded for it. See
				<a class="link" href="/sources">Sources</a> for where each state's data comes from, or
				<a class="link" href="{GITHUB}#quick-start" target="_blank" rel="noopener">run the API yourself</a>.
			</p>
		</main>
	</div>

	<SiteFooter />
</div>

<style>
	.docs :global(.link) {
		white-space: normal;
	}
	.lead {
		margin-top: 1rem;
		font-size: 1.15rem;
		color: var(--text-2);
		line-height: 1.7;
	}
	h2 {
		margin-top: 3rem;
		margin-bottom: 0.75rem;
		font-size: 1.35rem;
		font-weight: 600;
		scroll-margin-top: 96px;
	}
	h1 {
		scroll-margin-top: 96px;
	}
	p {
		margin-top: 0.75rem;
		color: var(--text-2);
		line-height: 1.75;
	}
	code {
		font-family: 'Geist Mono Variable', ui-monospace, monospace;
		font-size: 0.85em;
		background: var(--bg-muted);
		border-radius: 4px;
		padding: 0.1em 0.35em;
	}
	pre {
		margin-top: 0.75rem;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg-muted);
		padding: 1rem 1.25rem;
		font-size: 13px;
		line-height: 1.6;
	}
	pre code {
		background: none;
		padding: 0;
		font-size: inherit;
	}
	table {
		margin-top: 1rem;
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	th {
		text-align: left;
		font-weight: 600;
		border-bottom: 1px solid var(--border-strong);
		padding: 0.5rem 0.75rem 0.5rem 0;
	}
	td {
		vertical-align: top;
		border-bottom: 1px solid var(--border);
		padding: 0.6rem 0.75rem 0.6rem 0;
		color: var(--text-2);
		line-height: 1.6;
	}
	td:first-child {
		white-space: nowrap;
	}
</style>
