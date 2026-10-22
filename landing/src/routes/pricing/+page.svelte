<script lang="ts">
	import { GITHUB } from '$lib/examples';
	import SiteFooter from '$lib/landing/SiteFooter.svelte';
	import SiteNav from '$lib/landing/SiteNav.svelte';

	/** The plans in one table; the keyed plan's numbers are the ones the API
	 *  will enforce (docs/plans/api-keys-and-provider-tiers.html). */
	const PLANS = ['Free', 'API key', 'Self-hosted'];
	const ROWS: [string, string, string, string][] = [
		['Price', '$0', '$1.95 per 1,000 lookups, prepaid from $10. First 100 free.', '$0 + your server'],
		['Sign-up', 'None', 'Email', 'None'],
		['Geocoding', 'Our own servers', 'Ours plus commercial geocoders, so fewer addresses are declined', 'Whatever you configure'],
		['Declined addresses', '—', 'Not charged', '—'],
		['Limits', '10 a minute, 300 a day per IP', '120 a minute per key', 'None'],
		['History', '—', '90 days', 'Your database']
	];
</script>

<svelte:head>
	<title>Pricing · OpenTaxRate</title>
	<meta
		name="description"
		content="OpenTaxRate's API is free without a key, $1.95 per 1,000 lookups with one (first 100 free), and free to self-host."
	/>
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<SiteNav />

	<main class="mx-auto w-full max-w-[1000px] flex-1 px-5 pt-14 pb-10 sm:px-8 sm:pt-20">
		<h1 class="text-[36px] leading-tight font-semibold tracking-tight sm:text-[48px]">Pricing</h1>
		<p class="mt-3 text-[16px] text-[var(--text-muted)]">The same rates on every plan.</p>

		<div class="mt-10 overflow-x-auto">
			<table class="plans w-full min-w-[640px] border-collapse text-left text-[14.5px]">
				<thead>
					<tr class="border-b border-[var(--border-strong)]">
						<th scope="col" class="w-[18%] pb-3"><span class="sr-only">Plan detail</span></th>
						{#each PLANS as plan (plan)}
							<th scope="col" class="pr-4 pb-3 text-[15px] font-semibold {plan === 'API key' ? 'text-[var(--accent)]' : ''}">{plan}</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each ROWS as [what, ...cells] (what)}
						<tr>
							<th scope="row" class="py-3 pr-4 align-top font-normal text-[var(--text-muted)]">{what}</th>
							{#each cells as cell, i (i)}
								<td class="py-3 pr-4 align-top {i === 1 ? 'text-[var(--text)]' : 'text-[var(--text-2)]'}">{cell}</td>
							{/each}
						</tr>
					{/each}
					<tr>
						<th scope="row"><span class="sr-only">Start</span></th>
						<td class="pt-5 pr-4"><a class="btn" href="/">Look up an address</a></td>
						<td class="pt-5 pr-4"><a class="btn primary" href="/login">Get a key</a></td>
						<td class="pt-5 pr-4"><a class="btn" href="{GITHUB}#quick-start" target="_blank" rel="noopener">Quick start</a></td>
					</tr>
				</tbody>
			</table>
		</div>
	</main>

	<SiteFooter />
</div>

<style>
	.plans tbody tr + tr:not(:last-child) {
		border-top: 1px solid var(--border);
	}
</style>
