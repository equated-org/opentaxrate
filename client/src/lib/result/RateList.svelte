<script lang="ts">
	import type { AddressRate, Trace } from '$lib/api';
	import RateBar from '$lib/pixel/RateBar.svelte';
	import Actions from './Actions.svelte';
	import { howPlaced, MATCH_SHORT, partRows, pct, regionEditions, regionRows } from './format';
	import { isProvince } from '$lib/states';

	interface Props {
		rate: AddressRate;
		trace: Trace | null;
		url: string;
		raw: unknown;
		/** A picture of a result (the landing's showcase): no buttons, no ids. */
		preview?: boolean;
	}
	let { rate, trace, url, raw, preview = false }: Props = $props();

	const rows = $derived(partRows(rate, trace));
	const locationIds = $derived(Object.entries(rate.locationIds ?? {}));
	const details = $derived(regionRows(rate, rows));
	const editions = $derived(regionEditions(rate));
	const uncertain = $derived(rate.regions?.coverage.some((c) => c.status === 'location_uncertain') ?? false);
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

<section aria-labelledby={preview ? undefined : 'rate-heading'} class="flex flex-col gap-6">
	<div>
		<h2 id={preview ? undefined : 'rate-heading'} class="text-sm text-[var(--text-muted)]">Combined sales tax rate</h2>
		<p class="rate-big font-num mt-1 text-[52px] leading-none font-semibold tracking-[-0.04em] text-[var(--text)]">{pct(rate.rate)}</p>
		<p class="mt-2 text-sm text-[var(--text-muted)]">on {date} · {rate.match === 'statewide' && isProvince(rate.state) ? 'one rate across the province' : (MATCH_SHORT[rate.match] ?? rate.match)}</p>
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
					{#if row.code}<span class="part-code font-num ml-1.5 text-[10.5px] text-[var(--text-muted)] opacity-70">{row.code}</span>{/if}
					{#if row.ids.length}
						<span class="font-num mt-0.5 block text-[11.5px] text-[var(--text-muted)]">
							{row.ids.map(([key, value]) => `${key} ${value}`).join(' · ')}
						</span>
					{/if}
				</span>
				<span class="font-num text-[14.5px] font-medium">{pct(row.rate)}</span>
			</li>
		{/each}
	</ul>

	{#if rate.jurisdictions === 'uncertain'}
		<p class="-mt-3 text-[11.5px] text-[var(--text-muted)]">
			The rate is settled, but which jurisdictions it is paid to isn't{#if rate.alternatives?.length}: it could also be {rate.alternatives
					.map((a) => a.parts.filter((p) => p.kind !== 'state').map((p) => p.name ?? p.code).join(', '))
					.join('; or ')}{/if}.
		</p>
	{/if}

	{#if locationIds.length}
		<p class="font-num -mt-3 text-[11.5px] text-[var(--text-muted)]">
			This location: {locationIds.map(([key, value]) => `${key} ${value}`).join(' · ')}
		</p>
	{/if}

	{#if otherRates.length}
		<div class="text-sm text-[var(--text-muted)]">
			{#each otherRates as [label, value] (label)}
				<p>{label}: <span class="font-num font-medium text-[var(--text)]">{pct(value)}</span></p>
			{/each}
		</div>
	{/if}

	{#if rate.reporting}
		{@const r = rate.reporting}
		<div>
			<h3 class="text-sm font-semibold">For your return</h3>
			<p class="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
				File with the <a class="link" href={r.agency.url} target="_blank" rel="noopener">{r.agency.name}</a>{r.form
					? `, on the ${r.form}`
					: ''}.{#if rows.some((row) => row.ids.length) || locationIds.length}{' '}The state's own codes are listed under each tax, as its data gives them.{/if}
			</p>
			{#each r.notes as note, i (i)}
				<p class="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">{note}</p>
			{/each}
		</div>
	{/if}

	{#if details.length}
		<div>
			<h3 class="text-sm font-semibold">Local details</h3>
			<dl class="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)] text-sm">
				{#each details as d, i (i)}
					<div class="flex items-baseline gap-4 py-2">
						<dt class="w-[44%] shrink-0 text-[var(--text-muted)]">{d.label}</dt>
						<dd class="min-w-0 flex-1 break-words">
							<span class={d.label === 'ZIP+4' ? 'font-num' : ''}>{d.value}</span>
							{#if d.ids.length}
								<span class="font-num mt-0.5 block text-[11.5px] text-[var(--text-muted)]">
									{d.ids.map(([key, value]) => `${key} ${value}`).join(' · ')}
								</span>
							{/if}
							{#if d.note}<span class="mt-0.5 block text-[12.5px] leading-snug text-[var(--text-muted)]">{d.note}</span>{/if}
						</dd>
					</div>
				{/each}
			</dl>
			{#if editions.length || uncertain}
				<p class="mt-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
					{#if editions.length}From the publishers' own map layers, {editions.join(', ')}.{/if}
					{#if uncertain}Some layers aren't listed: the address is too near their edges to say.{/if}
				</p>
			{/if}
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

	{#if preview}
		<div class="flex gap-2" aria-hidden="true"><span class="btn">Copy as curl</span><span class="btn">Raw JSON</span></div>
	{:else}
		<Actions {url} {raw} />
	{/if}
</section>
