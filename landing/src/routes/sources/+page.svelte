<script lang="ts">
	import { GITHUB } from '$lib/examples';
	import StateSources from '$lib/landing/StateSources.svelte';
	import SiteFooter from '$lib/landing/SiteFooter.svelte';
	import SiteNav from '$lib/landing/SiteNav.svelte';
</script>

<svelte:head>
	<title>Sources · OpenTaxRate</title>
	<meta name="description" content="Where OpenTaxRate gets sales tax rates, how it matches them to your address, and what the results cover." />
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<SiteNav />

	<main class="mx-auto w-full max-w-[760px] flex-1 px-5 pt-14 pb-20 sm:px-8 sm:pt-20">
		<article>
			<h1 class="text-[36px] leading-tight font-semibold tracking-tight sm:text-[48px]">Where the rates come from</h1>
			<p class="mt-5 text-xl leading-relaxed text-[var(--text-2)]">
				We use publicly available tax rates from state and local tax agencies, including departments of revenue.
			</p>

			<section>
				<h2>What we use</h2>
				<p>
					Tax agencies publish rate tables, address lists and maps showing where local taxes apply.
					We bring those sources together so you can look up an address in one place.
				</p>
				<ul>
					<li><strong>Published rates.</strong> State tax tables, local tax notices and city ordinances tell us the rates.</li>
					<li><strong>Address lists and maps.</strong> State and local tax maps, along with US Census maps, help us find which taxes apply at your address.</li>
					<li><strong>California’s own lookup.</strong> For California, we ask the state’s tax agency for the rate when you search.</li>
				</ul>
			</section>

			<section>
				<h2>How your address gets a rate</h2>
				<p>
					Where a state publishes street address lists, we match your address to those lists.
					Elsewhere, we locate your address on a map to find its county, city and any special tax districts.
					A district is an area with an extra local tax, such as one that funds public transit.
				</p>
				<p>
					We then use that state’s rules to work out the total. In states with one rate everywhere,
					we use the statewide rate.
				</p>
			</section>

			<section>
				<h2>How current is the data?</h2>
				<p>
					Most searches use data we have already collected. New publications need to be loaded,
					and some rate changes need to be entered by hand. Updates are not instant.
					California’s lookup returns the state’s rate for today.
				</p>
				<p>
					Rates and boundaries can change at different times. An older rate may still be matched
					using today’s city or district boundaries.
				</p>
			</section>

			<section>
				<h2>What a result covers</h2>
				<p>
					The result is the general sales tax rate for the address. What you actually owe can depend
					on what you sell, exemptions and where the sale takes place.
				</p>
				<p>
					We have lookup methods for all 50 states and DC, but some addresses and local tax districts
					cannot be resolved. If the available information conflicts or is too uncertain,
					we may be unable to give you a rate.
				</p>
			</section>

			<div class="mt-12 border-t border-[var(--border)] pt-6 text-sm leading-relaxed text-[var(--text-muted)]">
				<p>
					Want to check a particular state?
					<a class="link" href="{GITHUB}/blob/main/docs/state-coverage.html" target="_blank" rel="noopener">See the detailed state coverage reference on GitHub</a>
					for source links and limits by state.
				</p>
			</div>
			<StateSources />
		</article>
	</main>

	<SiteFooter />
</div>

<style>
	section {
		margin-top: 2.5rem;
	}
	h2 {
		font-size: 1.25rem;
		font-weight: 600;
		line-height: 1.4;
		margin-bottom: 0.75rem;
	}
	section p, li {
		color: var(--text-2);
		font-size: 1rem;
		line-height: 1.8;
	}
	section p + p {
		margin-top: 1rem;
	}
	ul {
		list-style: disc;
		padding-left: 1.25rem;
		margin-top: 1rem;
	}
	li + li {
		margin-top: 0.75rem;
	}
	strong {
		font-weight: 600;
		color: var(--text);
	}
</style>
