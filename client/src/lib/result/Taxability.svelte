<script lang="ts">
	/** How the sale the lookup named (code=) is taxed here: the rate to charge,
	 *  or why there isn't one; each tax's rule with its dates and the pages
	 *  it was read from, linked to the original and to OpenTaxRate's archived
	 *  copy, scrolled to the quoted sentence. */
	import type { Taxability } from '$lib/api';
	import { codeName } from '$lib/codes';
	import { archivedOn } from '$lib/evidence';
	import { pct } from './format';

	interface Props {
		taxability: Record<string, Taxability>;
		/** The day the answer is for (YYYY-MM-DD). */
		date: string;
		/** The answer's parts, for naming the taxes a rule decides. */
		parts: Array<{ code: string; name?: string | null }>;
		preview?: boolean;
	}
	let { taxability, date, parts, preview = false }: Props = $props();

	const HEADLINE: Record<Taxability['treatment'], string> = {
		taxable: 'Taxed',
		partial: 'Partly taxed',
		not_taxed: 'Not taxed',
		conditional: 'Depends on the sale',
		not_researched: 'Not researched yet'
	};
	const TREATMENT: Record<string, string> = {
		taxable: 'taxable',
		special_rate: 'its own rate',
		exempt: 'exempt',
		zero_rated: 'zero-rated',
		conditional: 'depends',
		not_a_sale: 'not a sale',
		not_researched: 'not researched'
	};

	/** The archived copy in force on the answer's day, scrolled to the quote. */
	const archived = (url: string, quote?: string) => archivedOn(url, date, quote);
	const partName = (code: string) => parts.find((p) => p.code === code)?.name ?? code;
	const docsHref = (code: string) => `/docs/taxability#${encodeURIComponent(code)}`;
</script>

<section class="flex flex-col gap-5" aria-label="How this sale is taxed">
	{#each Object.entries(taxability) as [code, t] (code)}
		<div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
			<p class="text-sm text-[var(--text-muted)]">
				{codeName(code)}
				<a class="font-num ml-1 text-[12px] underline-offset-2 hover:underline" href={docsHref(code)} title="What this code covers">{code}</a>
			</p>
			<p class="mt-1 flex items-baseline gap-3">
				<span class="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">{HEADLINE[t.treatment]}</span>
				{#if t.rate !== null}<span class="font-num text-[22px] font-semibold text-[var(--text)]">{pct(t.rate)}</span>{/if}
			</p>
			{#if t.treatment === 'not_researched'}
				<p class="mt-1 text-sm text-[var(--text-2)]">
					No rule for this here on {date} yet. The combined rate above is for a general sale; don't use it for this one.
				</p>
			{:else if t.treatment === 'conditional'}
				<p class="mt-1 text-sm text-[var(--text-2)]">The answer turns on facts this code doesn't carry; each is listed below.</p>
			{/if}

			<ul class="mt-3 flex flex-col gap-3">
				{#each t.taxes as g, i (i)}
					<li class="border-t border-[var(--border)] pt-3 text-sm">
						<p class="text-[var(--text-muted)]">
							{g.parts.map(partName).join(', ')}
							<span class="ml-1">· {TREATMENT[g.treatment] ?? g.treatment}{g.rate !== null && g.treatment !== 'exempt' ? ` ${pct(g.rate)}` : ''}</span>
						</p>
						{#if g.rule}
							<p class="mt-1 leading-relaxed text-[var(--text)]">{g.rule.summary}</p>
							{#if g.rule.conditions.length}
								<ul class="mt-2 flex flex-col gap-1 text-[13px] text-[var(--text-2)]">
									{#each g.rule.conditions as c, j (j)}
										<li class="flex gap-2">
											<span class="shrink-0 font-medium">{TREATMENT[c.treatment] ?? c.treatment}{c.rate !== undefined ? ` ${pct(c.rate)}` : ''}</span>
											<span>{c.when}</span>
										</li>
									{/each}
								</ul>
							{/if}
							<p class="mt-2 text-[12.5px] text-[var(--text-muted)]">
								In force from {g.rule.from}{g.rule.to ? ` to ${g.rule.to}` : ''}{g.rule.fromIs === 'earliest_verified' ? ' (earliest verified)' : ''}
							</p>
							{#if !preview}
								{#snippet cite(c: (typeof g.rule.citations)[number])}
									<li>
										<a class="link" href={c.url} target="_blank" rel="noopener">{c.title}</a>
										<span class="text-[var(--text-muted)]">
											· <a class="link" href={archived(c.url, c.quote)} target="_blank" rel="noopener" title="OpenTaxRate's archived copy, at the quoted sentence">archived copy</a>
										</span>
										{#if c.quote}<span class="mt-0.5 block text-[12.5px] text-[var(--text-muted)]">“{c.quote}”</span>{/if}
									</li>
								{/snippet}
								<ul class="mt-2 flex flex-col gap-1.5 text-[13px]">
									{#each g.rule.citations.slice(0, 2) as c, k (k)}{@render cite(c)}{/each}
								</ul>
								{#if g.rule.citations.length > 2}
									<details class="mt-1.5 text-[13px]">
										<summary class="cursor-pointer text-[var(--text-muted)]">{g.rule.citations.length - 2} more source{g.rule.citations.length > 3 ? 's' : ''}</summary>
										<ul class="mt-1.5 flex flex-col gap-1.5">
											{#each g.rule.citations.slice(2) as c, k (k)}{@render cite(c)}{/each}
										</ul>
									</details>
								{/if}
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</section>
