<script lang="ts">
	import Pixels from '$lib/pixel/Pixels.svelte';
	import { PIN, RATE_UPDATE, UNCERTAINTY } from '$lib/pixel/art';

	/** Muted sprites use the same pixel grid as the site's other illustrations. */
	const palette = {
		'#': 'var(--text-muted)',
		o: 'color-mix(in srgb, var(--clay) 45%, var(--bg))',
		w: 'var(--bg)'
	};
	const ITEMS = [
		{
			icon: PIN,
			title: 'Resolved by street address',
			text: 'One ZIP can cross several tax boundaries. We use state address ranges and geographic boundaries to resolve your street address.'
		},
		{
			icon: RATE_UPDATE,
			title: 'Sources you can check',
			text: 'Each answer names the published data used. Rates carry effective dates; historical coverage varies by state.'
		},
		{
			icon: UNCERTAINTY,
			title: 'Clear when it’s uncertain',
			text: 'When the evidence cannot settle one rate, we explicitly decline the lookup. Missing data is never treated as zero.'
		}
	];
</script>

<ul class="grid gap-12 md:grid-cols-3 md:gap-12 lg:gap-20">
	{#each ITEMS as item (item.title)}
		<li>
			<div class="mb-5 flex h-12 w-12 items-center justify-center">
				<Pixels rows={item.icon} cell={3} {palette} />
			</div>
			<h2 class="text-[16px] font-semibold text-[var(--text)]">{item.title}</h2>
			<p class="mt-3 max-w-[32rem] text-[14.5px] leading-[1.8] text-[var(--text-muted)]">{item.text}</p>
		</li>
	{/each}
</ul>

<p class="mt-8 max-w-[48rem] text-[13px] leading-relaxed text-[var(--text-muted)]">
	Why boundaries matter: Stripe’s engineering team shows how two houses in the same ZIP can face different taxes.
	<a class="link" href="https://stripe.dev/blog/how-we-built-it-jurisdiction-resolution-for-stripe-tax" target="_blank" rel="noopener">Read their explanation ↗</a>
</p>
