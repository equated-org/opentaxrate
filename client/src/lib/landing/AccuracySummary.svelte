<script lang="ts">
	/**
	 * The landing page's accuracy and price claim, without naming competitors.
	 * Leads with the rates it returned and sets the declines
	 * apart, so they don't read as misses. Figures come from benchmark.json and
	 * pricing.json; the side-by-side comparison lives on /benchmarks.
	 */
	import data from '$lib/benchmark.json';
	import { pricing } from '$lib/pricing';
	import Pixels from '$lib/pixel/Pixels.svelte';

	const ours = data.services.find((s) => s.id === 'opentaxrate-providers');
	const price = pricing.rows.find((r) => r.id === 'opentaxrate-api')?.comparison?.perThousand;
	if (!ours || price === undefined)
		throw new Error('AccuracySummary: benchmark.json or pricing.json no longer has the hosted API');
	const answered = ours.right + ours.wrong;
	const palette = { '#': 'var(--accent)', x: 'var(--clay)', o: 'var(--text-muted)' };

	const RIGHT = ['###', '###', '###'];
	const WRONG = ['x.x', '.x.', 'x.x'];
	const DECLINED = ['ooo', 'o.o', 'ooo'];

	/** One 3×3 square per address, a one-pixel gutter between them. */
	function grid(cells: string[][], columns: number): string[] {
		const out: string[] = [];
		for (let start = 0; start < cells.length; start += columns) {
			const row = cells.slice(start, start + columns);
			if (start) out.push('.');
			for (let y = 0; y < 3; y++) out.push(row.map((c) => c[y]).join('.'));
		}
		return out;
	}
	const answeredRows = grid([...Array(ours.right).fill(RIGHT), ...Array(ours.wrong).fill(WRONG)], 25);
	const declinedRows = grid(Array(ours.refused).fill(DECLINED), 25);

	const summary = `Of ${ours.asked} random addresses, OpenTaxRate returned a rate for ${answered}, and ${ours.right} matched the state's published rate. ${ours.refused} addresses needed additional verification. $${price.toFixed(2)} per 1,000 lookups.`;
</script>

<section aria-labelledby="accuracy-heading" class="py-6 sm:py-10">
	<h2 id="accuracy-heading" class="text-[22px] leading-snug font-semibold tracking-[-0.01em] sm:text-[28px]">
		High accuracy. Lower cost.
	</h2>
	<p class="mt-3 max-w-[40rem] text-[15px] leading-relaxed text-[var(--text-muted)]">
		We tested {ours.asked} random addresses against each state's own published rate.{ours.wrong === 0
			? ' Every rate we returned was right.'
			: ''}
	</p>

	<div class="mt-12 grid items-start gap-14 md:grid-cols-[minmax(0,460px)_1fr] md:gap-20">
		<figure role="img" aria-label={summary}>
			<Pixels rows={answeredRows} {palette} cell={5} class="block h-auto w-full" />
			{#if ours.refused}
				<div class="mt-8 flex items-center gap-4">
					<Pixels rows={declinedRows} {palette} cell={5} />
					<span class="text-[13px] text-[var(--text-muted)]">Declined, not guessed</span>
				</div>
			{/if}
		</figure>

		<dl class="flex flex-col divide-y divide-[var(--border)]">
			<div class="flex flex-col-reverse pb-7">
				<dt class="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
					{ours.wrong === 0
						? 'rates returned, all matching the state. No wrong answers.'
						: `rates returned matching the state; ${ours.wrong} did not.`}
				</dt>
				<dd class="font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--accent)]">
					{ours.right}<span class="text-[var(--text-muted)]">/{answered}</span>
				</dd>
			</div>
			<div class="flex flex-col-reverse py-7">
				<dt class="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">
					addresses needed additional verification. Check the <a class="link" href="/sources">official state sources</a>.
				</dt>
				<dd class="font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--text)]">{ours.refused}</dd>
			</div>
			<div class="flex flex-col-reverse pt-7">
				<dt class="mt-2 text-[14px] leading-relaxed text-[var(--text-muted)]">per 1,000 lookups. Free without a key.</dt>
				<dd class="font-num text-[40px] leading-none font-semibold tracking-tight text-[var(--text)]">${price.toFixed(2)}</dd>
			</div>
		</dl>
	</div>

	<p class="mt-12 text-[14px]">
		<a class="link" href="/benchmarks">See how it compares with other providers →</a>
	</p>
</section>
