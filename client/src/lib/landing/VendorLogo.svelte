<script lang="ts" module>
	/** Logos fetched from each vendor's own site (favicon or touch icon),
	 *  scaled to 64px, in static/logos/. Vendors without one get a letter. */
	const LOGOS: Record<string, string> = {
		apiverve: '/logos/apiverve.png',
		avalara: '/logos/avalara.png',
		lovat: '/logos/lovat.png',
		quaderno: '/logos/quaderno.png',
		stripe: '/logos/stripe.png',
		taxcloud: '/logos/taxcloud.png',
		taxjar: '/logos/taxjar.png',
		zip2tax: '/logos/zip2tax.png',
		ziptax: '/logos/ziptax.png'
	};
</script>

<script lang="ts">
	import Pixels from '$lib/pixel/Pixels.svelte';
	import { MARK } from '$lib/pixel/art';

	/** `id` is the vendor id from benchmark.json or pricing.json; OpenTaxRate's
	 *  ids all start with "opentaxrate" and use the site's own pixel mark. */
	let { id, name }: { id: string; name: string } = $props();
	const src = $derived(LOGOS[id]);
</script>

{#if id.startsWith('opentaxrate')}
	<span class="logo text-[var(--text)]" role="img" aria-label="OpenTaxRate logo"><Pixels rows={MARK} cell={2} /></span>
{:else if src}
	<img class="logo" {src} alt="{name} logo" width="18" height="18" loading="lazy" />
{:else}
	<span class="logo letter" role="img" aria-label="{name} logo">{name[0]}</span>
{/if}

<style>
	.logo {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border-radius: 4px;
		object-fit: contain;
	}
	/* A hairline ring keeps dark logos visible on the dark theme. */
	img.logo {
		box-shadow: 0 0 0 1px var(--border);
	}
	.letter {
		background: var(--bg-muted);
		border: 1px solid var(--border-strong);
		color: var(--text-muted);
		font-size: 11px;
		font-weight: 600;
	}
</style>
