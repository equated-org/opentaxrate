<script lang="ts">
	import Benchmark from '$lib/landing/Benchmark.svelte';
	import LookupPipeline from '$lib/landing/LookupPipeline.svelte';
	import SiteFooter from '$lib/landing/SiteFooter.svelte';
	import SiteNav from '$lib/landing/SiteNav.svelte';
	import { noteNumbers, pricing as data } from '$lib/pricing';

	const num = noteNumbers(data);
	const marks = (ids: string[]) => ids.map((id) => num[id]).join(',');
</script>

<svelte:head>
	<title>Benchmarks · OpenTaxRate</title>
	<meta
		name="description"
		content="How often sales tax rate services match the states' own rates, and what a rate lookup costs with each."
	/>
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<SiteNav />

	<main class="mx-auto w-full max-w-[1000px] flex-1 px-5 pt-14 pb-10 sm:px-8 sm:pt-20">
		<h1 class="text-[36px] leading-tight font-semibold tracking-tight sm:text-[48px]">Benchmarks</h1>
		<LookupPipeline />

		<div>
			<Benchmark
				compact
				title="Accuracy"
				lead="OpenTaxRate matched the state's own rate for 98.9% of 277 random addresses (91.3% with only its own self-hosted geocoders) and gave no wrong rates; when unsure, it declines rather than guesses."
			/>
		</div>

		<section id="pricing" aria-labelledby="pricing-heading" class="mt-20 border-t border-[var(--border)] pt-14">
			<h2 id="pricing-heading" class="text-[19px] leading-snug font-semibold tracking-[-0.01em] sm:text-[22px]">Pricing</h2>
			<p class="mt-2 max-w-[44rem] text-[14.5px] leading-relaxed text-[var(--text-muted)]">
				Most vendors sell monthly plans, not calls. Spread over lookups, street-address services come to about $2–125 per 1,000. OpenTaxRate is $0 within free tiers and at most about $1.14 past them.
			</p>

			<p class="mt-6 flex items-center gap-2 text-[12.5px] text-[var(--text-muted)]">
				<span class="swatch" aria-hidden="true"></span>
				Shaded figures are our estimates; the rest are the vendors' published prices, as of {data.asOf}.
			</p>

			<table class="pricing mt-3 w-full border-collapse text-left text-sm">
				<caption class="sr-only">Published price and our estimated cost per 1,000 lookups, by vendor</caption>
				<thead>
					<tr class="border-b border-[var(--border-strong)] text-[12.5px] text-[var(--text-muted)]">
						<th scope="col" class="w-[24%] pb-2 pr-4 font-medium">Service</th>
						<th scope="col" class="pb-2 pr-4 font-medium">Published price</th>
						<th scope="col" class="w-[22%] pb-2 text-right font-medium">Per 1,000 lookups (est.)</th>
					</tr>
				</thead>
				<tbody>
					{#each data.rows as r (r.id)}
						<tr class:ours={r.ours}>
							<th scope="row" class="py-2.5 pr-4 align-top font-normal {r.ours ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-2)]'}">
								{r.name}
							</th>
							<td class="py-2.5 pr-4 align-top leading-snug text-[var(--text-2)]">{r.published}</td>
							<td class="py-2.5 text-right align-top">
								<span class="whitespace-nowrap"><span class="est font-num">{r.estimate}</span>{#if r.notes.length}<sup class="mark">{marks(r.notes)}</sup>{/if}</span>
								{#if r.estimateNote}<span class="mt-1 ml-auto block max-w-[15rem] text-[12px] leading-snug text-[var(--text-muted)]">{r.estimateNote}</span>{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<ol class="mt-4 flex flex-col gap-1 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
				{#each data.notes as n, i (n.id)}<li><sup class="mark">{i + 1}</sup> {n.text}</li>{/each}
			</ol>

			<details class="mt-6 text-sm">
				<summary class="cursor-pointer text-[13px] text-[var(--text-2)] hover:text-[var(--text)]">How we estimated, and sources</summary>
				<p class="mt-3 leading-relaxed text-[var(--text-muted)]">
					Each estimate spreads the cheapest plan with API access over an assumed number of lookups a month. They are
					planning figures, not quotes, and fall as volume rises. Prices change; dates are when we read each page.
				</p>
				<ul class="mt-4 flex flex-col gap-3 leading-relaxed">
					{#each data.rows as r (r.id)}
						<li>
							<span class="font-medium text-[var(--text)]">{r.name}.</span>
							<span class="text-[var(--text-2)]">{r.method}</span>
							{#if r.breakdown}
								<ul class="mt-1.5 list-disc pl-5 text-[var(--text-2)]">
									{#each r.breakdown as line (line)}<li class="text-[12.5px] tabular-nums">{line}</li>{/each}
								</ul>
							{/if}
							<span class="block text-[12.5px] text-[var(--text-muted)]">
								{#each r.sources as s, i (s.url)}{#if i > 0}{' · '}{/if}<a class="link" href={s.url} target="_blank" rel="noopener"
										>{s.label}</a
									>{' '}({s.checked}){/each}
							</span>
						</li>
					{/each}
				</ul>
			</details>

			<details class="mt-3 text-sm">
				<summary class="cursor-pointer text-[13px] text-[var(--text-2)] hover:text-[var(--text)]">Vendors that only quote</summary>
				<p class="mt-3 leading-relaxed text-[var(--text-muted)]">
					No price published to compute from:
					{#each data.quoteOnly as q, i (q.name)}{#if i > 0}{', '}{/if}<a class="link" href={q.url} target="_blank" rel="noopener">{q.name}</a>{/each}.
				</p>
			</details>
		</section>
	</main>

	<SiteFooter />
</div>

<style>
	.pricing tbody tr + tr {
		border-top: 1px solid var(--border);
	}
	.est {
		display: inline-block;
		background: var(--warn-soft);
		border-radius: 4px;
		padding: 0 0.4rem;
		color: var(--text);
		white-space: nowrap;
	}
	.swatch {
		display: inline-block;
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: var(--warn-soft);
		border: 1px solid color-mix(in srgb, var(--warn) 40%, transparent);
	}
	.mark {
		margin-left: 2px;
		color: var(--warn);
		font-size: 10px;
	}
	.ours th {
		color: var(--accent);
	}
</style>
