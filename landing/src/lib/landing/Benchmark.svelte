<script lang="ts">
	/**
	 * How often each rate service gives the state's own answer, on the same
	 * sample of addresses. Every number lives in benchmark.json. Prices are
	 * kept apart, on /benchmarks (pricing.json): not every priced vendor was
	 * benchmarked, so the two don't share a table.
	 */
	import data from '$lib/benchmark.json';

	type Tally = { asked: number; right: number; wrong: number; refused: number };
	const services = data.services;
	const methods = data.methods as { id: keyof (typeof services)[number]['byMethod']; label: string }[];
	const pct = (x: number) => `${x.toFixed(1)}%`;
	const cell = (t: Tally) => (t.asked ? `${t.right} / ${t.wrong} / ${t.refused}` : '—');

	/** `compact` (the /benchmarks page): the page's own heading and one-line
	 *  takeaway, with the method caption moved into the drawer. */
	let {
		title = "Checked against the states' own answers",
		lead = 'The same addresses, asked of each service. A rate counts as correct only if it matches what the state itself publishes for that address.',
		compact = false
	}: { title?: string; lead?: string; compact?: boolean } = $props();
</script>

<section aria-labelledby="benchmark-heading">
	<h2 id="benchmark-heading" class="text-[19px] leading-snug font-semibold tracking-[-0.01em] sm:text-[22px]">
		{title}
	</h2>
	<p class="mt-2 max-w-[44rem] text-[14.5px] leading-relaxed text-[var(--text-muted)]">
		{lead}
	</p>

	<div class="mt-7 overflow-x-auto">
		<table class="chart w-full min-w-[520px] border-collapse text-left text-sm">
			<caption class="sr-only">Percent correct, by service</caption>
			<thead>
				<tr class="text-[12.5px] text-[var(--text-muted)]">
					<th scope="col" class="w-[38%] pb-2 pr-4 font-medium">Service</th>
					<th scope="col" class="pb-2 font-medium">% correct</th>
				</tr>
			</thead>
			<tbody>
				{#each services as s (s.id)}
					<tr class:ours={s.ours}>
						<th scope="row" class="py-2 pr-4 align-middle font-normal text-[var(--text-2)]">
							<span class="block leading-snug {s.ours ? 'font-semibold text-[var(--text)]' : ''}">{s.name}</span>
							{#if s.detail}<span class="block text-[12.5px] leading-snug text-[var(--text-muted)]">{s.detail}</span>{/if}
						</th>
						<td class="py-2 align-middle">
							<div class="flex items-center gap-3" title="{s.name}: {s.right} correct of {s.asked} asked ({s.wrong} wrong, {s.refused} refused)">
								<div class="track h-[14px] flex-1" role="img" aria-label="{pct(s.pctCorrect)} correct of {s.asked} asked">
									<div class="bar h-full" style:width="{s.pctCorrect}%"></div>
								</div>
								<span class="font-num w-[52px] shrink-0 text-right text-[var(--text)]">{pct(s.pctCorrect)}</span>
								<span class="font-num w-[44px] shrink-0 text-[12px] text-[var(--text-muted)]">n={s.asked}</span>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if !compact}
		<p class="mt-4 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
			{data.caption}
			<a class="link ml-1 whitespace-nowrap" href="/benchmarks#pricing">Pricing →</a>
		</p>
	{/if}

	<details class="mt-5 text-sm">
		<summary class="cursor-pointer text-[13px] text-[var(--text-2)] hover:text-[var(--text)]">{compact ? 'How we tested' : 'How the states were read'}</summary>
		{#if compact}<p class="mt-3 leading-relaxed text-[var(--text-muted)]">{data.caption}</p>{/if}
		<div class="mt-4 overflow-x-auto">
			<table class="w-full min-w-[620px] border-collapse text-left text-[13px]">
				<caption class="mb-2 text-left text-[12.5px] text-[var(--text-muted)]">Right / wrong / refused, by how OpenTaxRate reads the state</caption>
				<thead>
					<tr class="border-y border-[var(--border-strong)]">
						<th scope="col" class="py-2 pr-3 font-semibold">Service</th>
						{#each methods as m (m.id)}<th scope="col" class="py-2 pr-3 font-semibold">{m.label}</th>{/each}
						<th scope="col" class="py-2 font-semibold">All</th>
					</tr>
				</thead>
				<tbody>
					{#each services as s (s.id)}
						<tr class="border-b border-[var(--border)]">
							<th scope="row" class="py-2 pr-3 font-medium">{s.name}</th>
							{#each methods as m (m.id)}<td class="font-num py-2 pr-3 text-[var(--text-2)]">{cell(s.byMethod[m.id])}</td>{/each}
							<td class="font-num py-2 text-[var(--text-2)]">{cell(s)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<ul class="mt-4 flex flex-col gap-2 leading-relaxed text-[var(--text-muted)]">
			{#each data.notes as note, i (i)}<li>{note}</li>{/each}
		</ul>
	</details>
</section>

<style>
	.track {
		background: var(--bg-muted);
		border-radius: 4px;
		overflow: hidden;
	}
	.bar {
		background: var(--text-muted);
		border-radius: 0 4px 4px 0;
	}
	.ours .bar {
		background: var(--accent);
	}
	.chart tbody tr + tr {
		border-top: 1px solid var(--border);
	}
</style>
