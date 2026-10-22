<svelte:head>
	<title>Regional data · OpenTaxRate Docs</title>
	<meta name="description" content="Supplemental regional boundaries returned by OpenTaxRate with include=regions." />
</svelte:head>

<h1>Regional data</h1>
<p class="lead">
	<code>include=regions</code> adds the transit areas, special districts and other published boundaries an address falls in. They
	describe evidence only: they don't change <code>rate</code> or <code>parts</code>, establish an exemption, or add a tax.
</p>

<h2 id="matches">Matches</h2>
<p><code>regions.matches</code> lists confirmed memberships, with the same shape in every state.</p>
<table>
	<thead><tr><th>Field</th><th>Description</th></tr></thead>
	<tbody>
		<tr><td><code>kind</code></td><td><code>transit</code>, <code>tax_area</code>, <code>special_district</code>, <code>civil</code>, <code>boundary_change</code>, <code>police_jurisdiction</code> or <code>incentive_zone</code>.</td></tr>
		<tr><td><code>type</code>, <code>name</code></td><td>The publisher's type, and its name for the area (nullable).</td></tr>
		<tr><td><code>ids</code>, <code>attributes</code></td><td>The publisher's ids and original attributes, names and units unchanged.</td></tr>
		<tr><td><code>featureId</code></td><td>The feature's id within its snapshot.</td></tr>
		<tr><td><code>source</code></td><td><code>id</code>, <code>url</code>, <code>snapshotId</code>, <code>edition</code>, <code>observedAt</code>, <code>startsOn</code>/<code>endsOn</code>, <code>dateBasis</code>, and a <code>note</code>.</td></tr>
	</tbody>
</table>

<h2 id="coverage">Coverage</h2>
<p>
	<code>regions.coverage</code> gives each source's status: <code>evaluated</code>, <code>unavailable</code>, <code>date_uncovered</code>,
	<code>location_uncertain</code>, <code>incomplete</code> or <code>error</code>. Only <code>evaluated</code> with no match means the
	address is outside that source's areas. A local source (Montgomery's police jurisdictions) says nothing about the rest of its state,
	and if placement is uncertain across a boundary, that membership is left out and the source marked uncertain.
</p>

<h2 id="dates">Dates</h2>
<p>
	Dated editions are chosen for the requested <code>date</code>. Undated sources give their latest snapshot for today's lookups, with
	<code>dateBasis: "latest_snapshot"</code>; its <code>observedAt</code> is not a legal effective date. Regional lookups may need extra
	geocoding.
</p>

<h2 id="sources">Sources</h2>
<p>
	Washington transit, city and location-code areas and Community Empowerment Zones; Utah transit; Tennessee improvement districts
	and civil boundaries; Nebraska tax areas and Good Life districts; South Dakota cities and special districts; Vermont local-option
	areas; Montgomery police jurisdictions; California and Minnesota tax areas; Iowa local-option areas; Arkansas municipal boundaries
	and changes; Virginia county cross-checks; West Virginia communities. <code>GET /v1/coverage</code> lists each state's
	<code>regionSources</code>; a registered source isn't necessarily loaded.
</p>
