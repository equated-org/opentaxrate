<script lang="ts">
	const ALABAMA = `"parts": [
  { "kind": "state", "name": "Alabama", "code": "45:01", "rate": 0.04, "ids": {} },
  { "kind": "county", "name": "MONTGOMERY COUNTY", "code": "00:101", "rate": 0.025,
    "ids": { "Locality Code": "7051", "County Number": "51", "Administered": "SELF" } },
  { "kind": "city", "name": "MONTGOMERY", "code": "01:51000", "rate": 0.035,
    "ids": { "Locality Code": "9454", "County Number": "51", "Administered": "SELF" } }
]`;
</script>

<svelte:head>
	<title>State codes and filing · OpenTaxRate Docs</title>
	<meta name="description" content="The state's own codes for each tax in an OpenTaxRate answer, and where the return goes." />
</svelte:head>

<h1>State codes and filing</h1>
<p class="lead">The codes a return asks for, and who it goes to.</p>

<h2 id="ids">State codes</h2>
<p>
	Each part's <code>ids</code> repeats what the state's rate data says about that tax: its codes, and who collects it. The whole
	location's codes are in <code>locationIds</code>. Keys are the publisher's own column names and values are exactly as published,
	leading zeros and all; we don't check them against a return's code list. Census FIPS codes are in <code>code</code>, never in
	<code>ids</code>. <code>locationIds</code> is <code>{'{}'}</code> when the address could be in areas whose ids differ.
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
		<tr><td>Streamlined states</td><td>None on parts; the location's <code>Composite SER Code</code> in <code>locationIds</code> where the state fills it (Washington's location code, zero-padded: <code>01726</code> is 1726)</td></tr>
		<tr><td>Everywhere else</td><td>None yet: <code>{'{}'}</code></td></tr>
	</tbody>
</table>

<h2 id="reporting">Reporting</h2>
<p><code>reporting</code> says where the tax is filed.</p>
<table>
	<thead><tr><th>Field</th><th>Description</th></tr></thead>
	<tbody>
		<tr><td><code>agency</code></td><td>The state agency the return goes to, and its sales tax page.</td></tr>
		<tr><td><code>form</code></td><td>The return most sellers file there.</td></tr>
		<tr><td><code>notes</code></td><td>Filing that doesn't go through the state: cities that collect their own tax, a separate program for remote sellers.</td></tr>
	</tbody>
</table>
