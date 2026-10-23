<script lang="ts">
	/** The development benchmark; the held-out comparison lives on /benchmarks. */
	import data from '$lib/development-benchmark.json';
	import { pricing } from '$lib/pricing';

	const price = pricing.rows.find((r) => r.id === 'opentaxrate-api')?.comparison?.perThousand;
	if (price === undefined) throw new Error('AccuracySummary: pricing.json no longer has the hosted API');
	const number = (n: number) => n.toLocaleString('en-US');

	// One square per address, grouped into three paths to keep the SVG small.
	const columns = 100;
	const groups = [
		{ count: data.right, fill: 'var(--accent)' },
		{ count: data.wrong, fill: 'var(--clay)' },
		{ count: data.refused, fill: 'var(--text-muted)' }
	];
	let offset = 0;
	const blocks = groups.map(({ count, fill }) => {
		const path = Array.from({ length: count }, (_, i) => {
			const index = offset + i;
			return `M${(index % columns) * 4} ${Math.floor(index / columns) * 4}h3v3h-3z`;
		}).join('');
		offset += count;
		return { path, fill };
	});
	const height = Math.ceil(data.asked / columns) * 4 - 1;
	// Where the wrong rates were, named in a note.
	const STATE_NAMES: Record<string, string> = { MO: 'Missouri', KS: 'Kansas', UT: 'Utah', WA: 'Washington', WV: 'West Virginia' };
	// Only states with more than one wrong rate, so a single miss isn't singled out.
	const top = Object.entries(data.wrongByState ?? {}).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 2);
	const topCount = top.reduce((sum, [, n]) => sum + n, 0);
	const wrongNote = top.length
		? `${topCount} of the ${data.wrong} in ${top.map(([st]) => STATE_NAMES[st] ?? st).join(' and ')}.`
		: '';
	const summary = `Development benchmark on ${data.asOf}: ${number(data.right)} of ${number(data.asked)} addresses correct, ${data.wrong} wrong rates, ${data.refused} declined lookups.`;
</script>

<section aria-labelledby="accuracy-heading" class="py-6 sm:py-10">
	<h2 id="accuracy-heading" class="text-[22px] leading-snug font-semibold tracking-[-0.01em] sm:text-[28px]">
		Measured against official answers.
	</h2>
	<p class="mt-3 max-w-[40rem] text-[15px] leading-relaxed text-[var(--text-muted)]">
		Random addresses in every state, each checked against the state’s own published rate. Development benchmark, {data.asOf}.
	</p>

	<div class="mt-12 grid items-start gap-14 md:grid-cols-[minmax(0,460px)_1fr] md:gap-20">
		<figure role="img" aria-label={summary}>
			<svg class="pixelated block h-auto w-full" width="399" {height} viewBox="0 0 399 {height}" aria-hidden="true">
				{#each blocks as block}
					<path d={block.path} fill={block.fill} />
				{/each}
			</svg>
			<figcaption class="mt-4 text-[13px] text-[var(--text-muted)]">
				One block per address. Blue: matched. Clay: wrong. Grey: declined.
			</figcaption>
		</figure>

		<dl class="flex flex-col divide-y divide-[var(--border)]">
			<div class="flex flex-col-reverse pb-7">
				<dt class="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
					addresses matched the state’s rate.
				</dt>
				<dd class="font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--accent)]">
					{number(data.right)}<span class="text-[var(--text-muted)]">/{number(data.asked)}</span>
				</dd>
			</div>
			<div class="grid grid-cols-2 gap-x-6 gap-y-2 py-7">
				<dt class="col-start-1 row-start-2 text-[14px] text-[var(--text-muted)]">wrong rates{#if wrongNote}<sup aria-hidden="true">*</sup>{/if}</dt>
				<dd class="col-start-1 row-start-1 font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--clay)]">{data.wrong}</dd>
				<dt class="col-start-2 row-start-2 text-[14px] text-[var(--text-muted)]">declined lookups</dt>
				<dd class="col-start-2 row-start-1 font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--text)]">{data.refused}</dd>
			</div>
			<div class="flex flex-col-reverse pt-7">
				<dt class="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">per 1,000 lookups. Free without a key.</dt>
				<dd class="font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--text)]">${price.toFixed(2)}</dd>
			</div>
		</dl>
	</div>

	{#if wrongNote}
		<p class="mt-12 max-w-[40rem] text-[13px] leading-relaxed text-[var(--text-muted)]"><span aria-hidden="true">* </span>{wrongNote}</p>
	{/if}

	<p class="{wrongNote ? 'mt-4' : 'mt-12'} text-[14px]">
		<a class="link" href="/benchmarks">Results, methodology and provider comparison →</a>
	</p>
</section>
