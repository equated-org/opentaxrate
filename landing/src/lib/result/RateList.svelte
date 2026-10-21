<script lang="ts">
	import type { AddressRate, Trace } from '$lib/api';
	import RateBar from '$lib/pixel/RateBar.svelte';
	import Actions from './Actions.svelte';
	import { howPlaced, MATCH_SHORT, partRows, pct } from './format';

	let { rate, trace, url, raw }: { rate: AddressRate; trace: Trace | null; url: string; raw: unknown } = $props();

	const rows = $derived(partRows(rate, trace));
	const lines = $derived(howPlaced(rate, trace));
	const today = new Date().toISOString().slice(0, 10);
	// The date the rate is for: the source names it ("... on 2026-10-21"),
	// else it's today's, the API's default.
	const date = $derived(rate.source.match(/\bon (\d{4}-\d{2}-\d{2})/)?.[1] ?? today);
	const otherRates = $derived.by(() => {
		const b = rate.byType;
		if (!b) return [];
		return [
			['Interstate', b.generalInterstate],
			['Food and drugs', b.foodDrug],
			['Food and drugs, interstate', b.foodDrugInterstate]
		].filter((r): r is [string, number] => r[1] !== null && r[1] !== b.general);
	});
</script>

<section aria-labelledby="rate-heading" class="flex flex-col gap-6">
	<div>
		<h2 id="rate-heading" class="text-sm text-[var(--text-muted)]">Combined sales tax rate</h2>
		<p class="font-pixel mt-1 text-[55px] leading-none tracking-tight text-[var(--text)]">{pct(rate.rate)}</p>
		<p class="mt-2 text-sm text-[var(--text-muted)]">on {date} · {MATCH_SHORT[rate.match] ?? rate.match}</p>
	</div>

	<RateBar
		segments={rows.filter((r) => !r.dim).map((r) => ({ rate: r.rate, color: r.color, label: `${r.name} ${pct(r.rate)}` }))}
	/>

	<ul class="-mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
		{#each rows as row, i (i)}
			<li class="flex items-baseline gap-3 py-2.5 text-[15px] {row.dim ? 'text-[var(--text-muted)]' : ''}">
				<span class="pixelated mt-0.5 inline-block h-2.5 w-2.5 shrink-0 self-center" style="background: {row.color}"></span>
				<span class="min-w-0 flex-1">
					{row.name}
					{#if row.code}<span class="ml-1 font-mono text-[11px] text-[var(--text-muted)]">{row.code}</span>{/if}
				</span>
				<span class="font-pixel text-[15px] tabular-nums">{pct(row.rate)}</span>
			</li>
		{/each}
	</ul>

	{#if otherRates.length}
		<div class="text-sm text-[var(--text-muted)]">
			{#each otherRates as [label, value] (label)}
				<p>{label}: <span class="font-pixel text-[var(--text)]">{pct(value)}</span></p>
			{/each}
		</div>
	{/if}

	<div>
		<h3 class="text-sm font-semibold">How it was placed</h3>
		{#each lines as line, i (i)}
			<p class="mt-1 text-sm leading-relaxed text-[var(--text-2)]">{line}</p>
		{/each}
	</div>

	<div>
		<h3 class="text-sm font-semibold">Source</h3>
		<p class="mt-1 text-sm leading-relaxed break-words text-[var(--text-2)]">{rate.source}</p>
	</div>

	<Actions {url} {raw} />
</section>
