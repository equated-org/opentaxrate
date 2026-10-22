<script lang="ts">
	import { isDominated, points } from '$lib/accuracy-price';
	let selected = $state(points[0].id);
	const active = $derived(points.find((p) => p.id === selected)!);
	const money = (price: number) => `$${price.toFixed(2)}`;
</script>

<section id="benchmark-appendix" aria-labelledby="appendix-heading" class="mt-16 scroll-mt-20 border-t border-[var(--border)] pt-10">
	<h2 id="appendix-heading" class="text-[22px] font-semibold tracking-tight">Appendix</h2>
	<details class="mt-4 text-sm">
		<summary class="cursor-pointer text-[13px] text-[var(--text-muted)]">Chart data and assumptions</summary>
	<div class="mt-5 overflow-x-auto">
		<table class="w-full min-w-[560px] border-collapse text-left text-[13px]">
			<caption class="sr-only">Chart data at 2,000 lookups per month. Select a service for its price assumptions.</caption>
			<thead class="border-b border-[var(--border-strong)] text-[var(--text-muted)]">
				<tr><th scope="col" class="py-2 font-medium">Service / assumptions</th><th scope="col" class="font-medium">Correct / asked</th><th scope="col" class="font-medium">USD / 1,000</th><th scope="col" class="font-medium">Comparison</th></tr>
			</thead>
			<tbody>
				{#each points as point}
					<tr class="border-b border-[var(--border)]">
						<th scope="row" class="py-3 pr-3 font-medium"><button class="link cursor-pointer text-left" aria-pressed={selected === point.id} onclick={() => selected = point.id}>{point.name}{point.conditional ? '*' : ''}</button></th>
						<td class="font-num pr-3">{point.accuracy.toFixed(1)}% · {point.right}/{point.asked}</td>
						<td class="font-num pr-3">{money(point.price)}</td>
						<td>{point.conditional ? point.id === 'apiverve' ? 'Separate sample; excluded from frontier' : 'Conditional; excluded from frontier' : isDominated(point, points) ? 'Dominated in this comparison' : 'Not dominated in this comparison'}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="mt-3 min-h-[4rem] text-[13px] leading-relaxed text-[var(--text-muted)]" aria-live="polite"><strong class="text-[var(--text)]">{active.name}.</strong> {active.note}</p>
	</details>
	<p class="mt-3 text-[12.5px] text-[var(--text-muted)]">
		<a class="link" href="/benchmarks/accuracy-price.svg" download>SVG</a> ·
		<a class="link" href="/benchmarks/accuracy-price.csv" download>Data and sources (CSV)</a>
	</p>
</section>
