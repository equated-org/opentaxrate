<script lang="ts">
	import { stateName } from '$lib/states';
	import { GITHUB } from '$lib/examples';

	// Plain-language summary of docs/state-coverage.html.
	const streamlinedStates = [
		'AR', 'GA', 'IN', 'IA', 'KS', 'KY', 'MI', 'MN', 'NE', 'NV', 'NJ', 'NC',
		'ND', 'OH', 'OK', 'RI', 'SD', 'TN', 'UT', 'VT', 'WA', 'WV', 'WI', 'WY'
	];
	const otherSources: Record<string, string> = {
		AL: 'Department of Revenue rate files and US Census maps.',
		AK: 'Alaska Remote Seller Sales Tax Commission rates and maps. Covers participating communities.',
		AZ: 'Department of Revenue monthly rate files and official tax maps.',
		CA: 'California Department of Tax and Fee Administration’s address lookup. Returns today’s rate.',
		CO: 'Colorado’s sales tax lookup service, including rates and tax-area maps.',
		CT: 'A statewide rate table maintained by OpenTaxRate.',
		DE: 'A statewide table maintained by OpenTaxRate: no general sales tax.',
		DC: 'A district-wide rate table maintained by OpenTaxRate.',
		FL: 'Department of Revenue county tax table (DR-15DSS), entered by hand, and US Census maps.',
		HI: 'General excise tax and county surcharge tables, entered by hand, and US Census maps.',
		ID: 'State rate and city tax ordinances, entered by hand, and US Census maps.',
		IL: 'Department of Revenue rate files, address lists and official tax maps.',
		LA: 'Louisiana Sales and Use Tax Commission for Remote Sellers’ lookup, plus US Census and local maps.',
		ME: 'A statewide rate table maintained by OpenTaxRate.',
		MD: 'A statewide rate table maintained by OpenTaxRate.',
		MA: 'A statewide rate table maintained by OpenTaxRate.',
		MS: 'Department of Revenue rates, entered by hand, and US Census maps.',
		MO: 'Department of Revenue address lists and quarterly rate spreadsheets.',
		MT: 'A statewide table with no general sales tax, plus a list of resort areas with local taxes. Maintained by OpenTaxRate.',
		NH: 'A statewide table maintained by OpenTaxRate: no general sales tax.',
		NM: 'Taxation and Revenue Department maps showing tax areas and their combined rates.',
		NY: 'State tax rate publication (Publication 718), entered by hand, and US Census maps.',
		OR: 'A statewide table maintained by OpenTaxRate: no general sales tax.',
		PA: 'Department of Revenue rates, entered by hand, and US Census maps.',
		SC: 'State tax rate publication (ST-500), entered by hand, plus US Census and state maps.',
		TX: 'Texas Comptroller rate files, spreadsheets, published tax information and official tax maps.',
		VA: 'Virginia Tax’s spreadsheet of rates by location and date, plus US Census maps.'
	};
	const publishedSources: Record<string, string> = {
		AL: 'https://www.revenue.alabama.gov/wp-content/uploads/2024/03/taxrates.csv',
		AK: 'https://alaska.atr.avalara.com',
		AZ: 'https://azdor.gov',
		CA: 'https://services.maps.cdtfa.ca.gov/',
		CO: 'https://salestaxlookup.colorado.gov',
		FL: 'https://www.floridarevenue.com/Pages/forms_index.aspx',
		HI: 'https://files.hawaii.gov/tax/legal/brochures/GE_brochure-25.pdf',
		IL: 'https://tax.illinois.gov/content/dam/soi/en/web/tax/research/taxrates/documents/salestaxrates',
		LA: 'https://remotesellersfiling.louisiana.gov/lookup/lookup.aspx',
		MO: 'https://dor.mo.gov/taxation/business/tax-types/sales-use/documents',
		NM: 'https://services5.arcgis.com/f4lpEvI6fkgVYigk/arcgis/rest/services',
		NY: 'https://www.nystax.gov/pubs_and_bulls/publications/sales/st_pubs_and_bulls_by_number.htm',
		SC: 'https://dor.sc.gov/tax-index/sales-and-use/Sales%20Notices/ST500.pdf',
		TX: 'https://comptroller.texas.gov',
		VA: 'https://www.tax.virginia.gov/sites/default/files/inline-files/sales-and-use-tax-rates-by-locality-by-date.xlsx'
	};
	const maintainedTables: Record<string, string> = {
		ID: 'ingest/states/idaho.ts',
		MS: 'ingest/states/mississippi.ts',
		PA: 'ingest/states/pennsylvania.ts'
	};
	const rows = [
		...streamlinedStates.map((code) => ({
			code,
			source: 'State-published rate and address files from Streamlined Sales Tax.',
			href: 'https://www.streamlinedsalestax.org/ratesandboundry',
			linkLabel: 'View published files'
		})),
		...Object.entries(otherSources).map(([code, source]) => ({
			code,
			source,
			href: publishedSources[code] ?? `${GITHUB}/blob/main/src/${maintainedTables[code] ?? 'rates/statewide.ts'}`,
			linkLabel: publishedSources[code] ? 'View published source' : 'View maintained table on GitHub'
		}))
	].sort((a, b) => stateName(a.code).localeCompare(stateName(b.code)));
</script>

<section class="mt-12" aria-labelledby="state-sources-heading">
	<h2 id="state-sources-heading" class="mb-3 text-xl leading-snug font-semibold">Sources by state</h2>
	<p id="state-sources-note" class="mb-6 leading-relaxed text-[var(--text-2)]">
		All 50 states and DC are listed below. Streamlined Sales Tax is a shared publishing program:
		participating states provide their own rate and address files through it.
		<a class="link" href="https://www.streamlinedsalestax.org/ratesandboundry" target="_blank" rel="noopener">View those files</a>.
		<a class="link" href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noopener">US Census maps</a>
		help us locate county and city boundaries; tax rates come from the other sources listed.
	</p>
	<table class="w-full border-collapse text-left text-sm leading-relaxed" aria-describedby="state-sources-note">
		<caption class="sr-only">Sales tax data sources for all 50 states and the District of Columbia</caption>
		<thead>
			<tr class="border-y border-[var(--border-strong)]">
				<th scope="col" class="w-[32%] py-3 pr-4 font-semibold">State</th>
				<th scope="col" class="py-3 font-semibold">Sources we use</th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.code)}
				<tr class="border-b border-[var(--border)]">
					<th scope="row" class="py-4 pr-4 align-top font-medium">{stateName(row.code)}</th>
					<td class="py-4 align-top text-[var(--text-2)]">
						{row.source}
						<a class="link mt-1 block w-fit" href={row.href} target="_blank" rel="noopener" aria-label="{stateName(row.code)}: {row.linkLabel}">{row.linkLabel}</a>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
