<script lang="ts">
	/**
	 * Two or three lookups side by side (/?q=A&vs=B&vs=C): a sketch of where
	 * each address sits among the outlines that tell them apart, then each
	 * full answer.
	 * Each column links to that address's own result, with the live map.
	 */
	import type { LookupResult } from '$lib/api';
	import type { Suggestion } from '$lib/search/types';
	import Limited from './Limited.svelte';
	import PairSketch, { type Side } from './PairSketch.svelte';
	import RateList from './RateList.svelte';
	import Refusal from './Refusal.svelte';
	import { distance, pct } from './format';

	let { pair, onretry }: { pair: { suggestion: Suggestion; result: LookupResult | null }[]; onretry: () => void } = $props();

	const TAGS = ['A', 'B', 'C'];
	const rates = $derived(pair.map(({ result }) => (result?.kind === 'rate' ? result.rate.rate : null)));
	/** Only the addresses the engine placed on the map: an answer from a
	 *  street range or a statewide rate has no point or outlines to compare. */
	const sides = $derived(
		pair.flatMap(({ result }, i): Side[] => {
			const trace = result && (result.kind === 'rate' || result.kind === 'refusal') ? result.trace : null;
			return trace?.point ? [{ tag: TAGS[i], point: trace.point, rate: rates[i], outlines: trace.outlines }] : [];
		})
	);
	const zips = $derived(new Set(pair.map((p) => p.suggestion.zip.slice(0, 5))));
	const cities = $derived(new Set(pair.map((p) => p.suggestion.city.toLowerCase())));
	/** How far apart the farthest two are, where there are points to tell. */
	const apart = $derived.by(() => {
		const points = pair.map(({ suggestion }, i) => sides.find((s) => s.tag === TAGS[i])?.point ?? suggestion);
		let most = 0;
		for (const a of points)
			for (const b of points) {
				if (![a.lon, a.lat, b.lon, b.lat].every(Number.isFinite)) continue;
				const cos = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
				most = Math.max(most, Math.hypot((a.lon - b.lon) * cos * 111_320, (a.lat - b.lat) * 110_540));
			}
		return most;
	});
	const distinct = $derived([...new Set(rates.filter((r): r is number => r !== null).map((r) => pct(r)))]);
	const COUNT = ['', 'One', 'Two', 'Three'];
	const heading = $derived.by(() => {
		const where = zips.size === 1 ? `Same ZIP, ${[...zips][0]}` : `${COUNT[pair.length]} addresses`;
		if (rates.some((r) => r === null)) return `${where}.`;
		if (distinct.length === 1) return `${where}, one rate: ${distinct[0]}.`;
		return `${where}. ${COUNT[distinct.length]} rates: ${distinct.slice(0, -1).join(', ')} and ${distinct.at(-1)}.`;
	});
	const differ = $derived(distinct.length > 1);
	/** A sketch needs every answer, and two addresses on the map. */
	const ready = $derived(pair.every((p) => p.result) && sides.length > 1);
	const note = $derived(
		[
			apart > 0
				? `${cities.size === 1 ? `All addressed to ${pair[0].suggestion.city}, at most` : 'At most'} ${distance(apart)} apart.`
				: '',
			differ && zips.size === 1 ? 'A ZIP is a mail route and a mailing city is the post office’s name; neither is a tax area.' : '',
			differ && ready ? 'Filled outlines hold some of the addresses and not the others.' : ''
		]
			.filter(Boolean)
			.join(' ')
	);
	const limited = $derived(pair.map((p) => p.result).find((r) => r?.kind === 'limited'));
</script>

<section class="flex flex-col gap-8" aria-labelledby="compare-heading">
	<div>
		<h2 id="compare-heading" class="text-[22px] leading-snug font-semibold tracking-[-0.01em] sm:text-[28px]">{heading}</h2>
		<p class="mt-2 max-w-[48rem] text-sm leading-relaxed text-[var(--text-muted)]">{note}</p>
	</div>

	{#if limited?.kind === 'limited'}
		<Limited message={limited.message} retryAfter={limited.retryAfter} {onretry} />
	{:else if ready}
		<PairSketch {sides} />
	{/if}

	<div class="grid gap-10 {pair.length > 2 ? 'lg:grid-cols-3' : 'md:grid-cols-2'}">
		{#each pair as { suggestion, result }, i (i)}
			<div class="min-w-0">
				<p class="mb-5 flex items-baseline gap-2 text-sm break-words text-[var(--text-muted)]">
					<span class="font-num shrink-0 rounded-full bg-[var(--text)] px-2 text-[12px] font-semibold text-[var(--bg)]">{TAGS[i]}</span>
					<span class="min-w-0 flex-1">{suggestion.label}</span>
					<a class="link shrink-0" href="/?q={encodeURIComponent(suggestion.label)}">Map →</a>
				</p>
				{#if result?.kind === 'rate'}
					<RateList rate={result.rate} trace={result.trace} url={result.url} raw={result.raw} />
				{:else if result?.kind === 'refusal'}
					<Refusal message={result.message} code={result.code} trace={result.trace} url={result.url} raw={result.raw} />
				{:else if result?.kind === 'failed'}
					<p class="text-sm leading-relaxed text-[var(--text-2)]">{result.message}</p>
				{/if}
			</div>
		{/each}
	</div>
</section>
