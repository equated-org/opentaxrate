<script lang="ts">
	import { points } from '$lib/accuracy-price';
	const x = (price: number) => 80 + (Math.log10(price) + 1) / 3 * 650;
	const y = (accuracy: number) => 325 - accuracy / 100 * 270;
	const money = (price: number) => `$${price.toFixed(2)}`;
	const ticks = [0.1, 0.5, 1, 2, 5, 10, 20, 50, 100];
	const levels = [0, 20, 40, 60, 80, 100];
</script>

<section id="accuracy-price" class="mt-16 scroll-mt-20 border-t border-[var(--border)] pt-10" aria-labelledby="tradeoff-heading">
	<h2 id="tradeoff-heading" class="text-[22px] font-semibold tracking-tight">Accuracy vs. price</h2>
	<p class="mt-2 text-[13px] text-[var(--text-muted)]">2,000 lookups per month. Higher and further left is better.</p>
	<div class="mt-6 overflow-x-auto">
		<svg viewBox="0 0 820 400" class="w-full min-w-[600px]" role="img" aria-labelledby="tradeoff-title tradeoff-desc">
			<title id="tradeoff-title">Measured accuracy against estimated dollars per 1,000 lookups</title>
			<desc id="tradeoff-desc">Higher and further left is better. The horizontal axis is logarithmic, from $0.10 to $100; accuracy runs from 0 to 100 percent. Hollow dots have conditional prices or a separate sample, including APIVerve’s 87 ZIP-code lookups. Full figures and methodology are on the benchmarks page.</desc>
			{#each levels as level}
				<line x1="80" x2="730" y1={y(level)} y2={y(level)} stroke="var(--border)" />
				<text x="65" y={y(level) + 4} text-anchor="end">{level}%</text>
			{/each}
			{#each ticks as tick}
				<line x1={x(tick)} x2={x(tick)} y1="55" y2="325" stroke="var(--border)" />
				<text x={x(tick)} y="348" text-anchor="middle">${tick}</text>
			{/each}
			<text x="80" y="25">Correct / asked (%) ↑</text>
			<text x="405" y="383" text-anchor="middle">Estimated USD / 1,000 lookups · log scale · ← cheaper</text>
			{#each points as point}
				<circle cx={x(point.price)} cy={y(point.accuracy)} r={point.id === 'opentaxrate-api' ? 10 : 7}
					fill={point.conditional ? 'var(--bg)' : point.id === 'opentaxrate-api' ? 'var(--accent)' : 'var(--text-muted)'}
					stroke={point.id === 'opentaxrate-api' ? 'var(--accent)' : 'var(--text-muted)'} stroke-width="2">
					<title>{point.name}: {point.accuracy.toFixed(1)}% ({point.right}/{point.asked}), {money(point.price)} per 1,000. {point.note}</title>
				</circle>
				<text x={x(point.price) + 15}
					y={y(point.accuracy) + (point.id === 'avalara' ? -16 : point.id === 'taxjar' ? 7 : 20)}
					text-anchor="start">{point.name}{point.conditional ? '*' : ''}</text>
			{/each}
		</svg>
	</div>
	<p class="text-[12.5px] leading-relaxed text-[var(--text-muted)]">
		○ Conditional price or separate sample. <a class="link" href="/benchmarks#benchmark-appendix">Details on the benchmarks page</a>.
	</p>
</section>

<style>
	svg text { fill: var(--text-muted); font-size: 12px; font-family: inherit; }
</style>
