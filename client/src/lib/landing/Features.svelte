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
			title: 'Accurate to the address',
			text: 'Sales tax can change across a city line. We look up the rate for your street address, rather than a ZIP code average.'
		},
		{
			icon: RATE_UPDATE,
			title: 'Updated from official sources',
			text: 'We keep rates updated from the data published by state tax agencies, with a source you can check.'
		},
		{
			icon: UNCERTAINTY,
			title: 'Clear when it’s uncertain',
			text: 'If an address is ambiguous, we return the possible rates. We never guess or treat missing data as zero.'
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
