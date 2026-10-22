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
  "locationIds": { "Composite SER Code": "01726" },
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
				<a class="link" href="/dashboard/keys">dashboard</a>; lookups are paid from your credit (<a class="link" href="/pricing">pricing</a>), 120 a minute per key.
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
		<tr><td><code>rate</code></td><td>The combined rate on a general sale.</td></tr>
		<tr><td><code>stateRate</code>, <code>localRate</code></td><td>The state's part, and everything else.</td></tr>
		<tr><td><code>byType</code></td><td>Rates on interstate and food-and-drug sales; <code>null</code> where the state publishes none.</td></tr>
		<tr><td><code>parts</code></td><td>Each tax adding up to <code>rate</code>: <code>kind</code> (<code>state</code>, <code>county</code>, <code>city</code>, <code>district</code>), <code>name</code>, <code>code</code> (the publisher's type and code, e.g. <code>01:63000</code>), <code>rate</code>, <code>byType</code>, and <code>ids</code>.</td></tr>
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
		<tr><td><code>source</code></td><td>The files or service the rate came from, and the date.</td></tr>
		<tr><td><code>reporting</code></td><td>The agency, return, and any local filing. See <a class="link" href="/docs/codes#reporting">Reporting</a>.</td></tr>
		<tr><td><code>regions</code></td><td>With <code>include=regions</code>. See <a class="link" href="/docs/regions">Regional data</a>.</td></tr>
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
