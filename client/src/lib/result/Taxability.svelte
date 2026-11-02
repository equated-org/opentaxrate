<script lang="ts">
	/** How the sale the lookup named (code=) is taxed here: the rate to charge,
	 *  or why there isn't one; each tax's rule with its dates and the pages
	 *  it was read from, linked to the original and to OpenTaxRate's archived
	 *  copy, scrolled to the quoted sentence. An original that's gone
	 *  (offline-originals.json) is named, not linked: the copy is the evidence.
	 *  With describe=, what the words were read as: the code, the cases they
	 *  settled, or the codes they could be; a model only picked among offered
	 *  options, and the rules decided. */
	import type { Taxability } from '$lib/api';
	import { codeName, isCode } from '$lib/codes';
	import { archivedOn, offline, offlineChecked } from '$lib/evidence';
	import { pct } from './format';

	interface Props {
		taxability: Record<string, Taxability>;
		/** The day the answer is for (YYYY-MM-DD). */
		date: string;
		/** The answer's parts, for naming the taxes a rule decides. */
		parts: Array<{ code: string; name?: string | null }>;
		preview?: boolean;
		/** Ask again with a narrower code (an outcome's), where the page can. */
		onpick?: (code: string) => void;
		/** Show each code's verdict here; off when the page's headline already
		 *  gives it (one code), leaving the cases, the rules and the sources. */
		headline?: boolean;
	}
	let { taxability, date, parts, preview = false, onpick, headline = true }: Props = $props();

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
	const sure = (p: number) => `${Math.round(p * 100)}%`;
	/** The facts a description can't settle (needs), in words. */
	const NEED: Record<string, string> = {
		code: 'which code it is',
		seller_kind: "the seller's share of prepared-food sales",
		locality: 'which local taxes the place levies',
		payment_date: 'when it was paid for',
		title_transfer: 'when title passed',
		qualifying_total: 'the qualifying total',
		contract_total: 'the contract total',
		quantity_by_kind: 'how many of each kind'
	};
</script>

<section class="flex flex-col gap-5" aria-label="How this sale is taxed">
	{#each Object.entries(taxability) as [code, t] (code)}
		{@const read = t.interpreted}
		{@const shownCode = isCode(code) ? code : (read?.code ?? null)}
		<div class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
			<p class="text-sm text-[var(--text-muted)]">
				{#if !isCode(code)}<span class="text-[var(--text-2)]">“{code}”</span>{#if headline && shownCode}<span> · {codeName(shownCode)}</span>{/if}{:else}{headline ? codeName(code) : 'Why'}{/if}
				{#if shownCode}<a class="font-num ml-1 text-[12px] underline-offset-2 hover:underline" href={docsHref(shownCode)} title="What this code covers">{shownCode}</a>{/if}
			</p>
			{#if headline}
				<p class="mt-1 flex items-baseline gap-3">
					<span class="text-[22px] font-semibold tracking-[-0.02em] text-[var(--text)]">{HEADLINE[t.treatment]}</span>
					{#if t.rate !== null}<span class="font-num text-[22px] font-semibold text-[var(--text)]">{pct(t.rate)}</span>{/if}
				</p>
			{/if}
			{#if read}
				<div class="mt-2 rounded-lg bg-[var(--bg-muted)] px-3 py-2 text-[13px] text-[var(--text-2)]" aria-label="How the description was read">
					{#if read.unavailable}
						<p>The description couldn't be read just now; this answers as if it wasn't sent.</p>
					{:else}
						{#if read.from === 'text' && read.code}
							<p>Read as <span class="font-medium text-[var(--text)]">{codeName(read.code)}</span> <span class="font-num">({read.code}, {sure(read.confidence ?? 0)})</span>.</p>
						{:else if read.from === 'code' && read.code && read.mismatch}
							<p class="text-[var(--warn)]">
								The description reads as {codeName(read.code)} <span class="font-num">({read.code})</span>, not the code sent; this answers for the code.
								{#if onpick}<button type="button" class="link ml-1" onclick={() => onpick(read.code!)}>use {codeName(read.code)}</button>{/if}
							</p>
						{:else if read.from === 'code' && read.mismatch}
							<p class="text-[var(--warn)]">The description doesn't read as anything the codes cover; this answers for the code sent.</p>
						{:else if !read.code && read.candidates?.length}
							<p>
								Not one code: it could be
								{#each read.candidates as c, k (c)}{k ? ', ' : ' '}{#if onpick}<button type="button" class="link" onclick={() => onpick(c)}>{codeName(c)}</button>{:else}{codeName(c)}{/if}{/each}.
								Pick the one that fits.
							</p>
						{:else if read.from === 'text' && !read.code}
							<p>No code here covers what the description says was sold.</p>
						{/if}
						{#each read.conditions ?? [] as c, k (k)}
							<p class="mt-1">Settled from the description: <span class="text-[var(--text)]">{c.when.join(' or ')}</span> <span class="font-num text-[var(--text-muted)]">({c.tax}, {sure(c.confidence)})</span></p>
						{/each}
						{#if t.needs?.length}
							<p class="mt-1">A description can't settle: {t.needs.map((n) => NEED[n] ?? n).join('; ')}.</p>
						{/if}
						<p class="mt-1 text-[12px] text-[var(--text-muted)]">A model only picked among the codes' and rules' own words; the rules decided the tax. Facts the description doesn't state stay open.</p>
					{/if}
				</div>
			{/if}
			{#if t.treatment === 'not_researched' && headline}
				<p class="mt-1 text-sm text-[var(--text-2)]">
					No rule for this here on {date} yet. The combined rate above is for a general sale; don't use it for this one.
				</p>
			{:else if t.treatment === 'conditional'}
				{#if headline}<p class="mt-1 text-sm text-[var(--text-2)]">The answer turns on facts this code doesn't carry; each is listed below.</p>{/if}
				{#if t.outcomes?.length && t.independent}
					<p class="mt-2 text-[13px] text-[var(--text-2)]">
						These taxes turn on their facts independently: pick one case for each tax. Each rate is that case plus the settled taxes.
					</p>
				{/if}
				{#if t.outcomes?.length}
					<ul class="mt-3 flex flex-col gap-1.5 text-sm">
						{#each t.outcomes as o, j (j)}
							<li class="flex items-baseline gap-3">
								<span class="font-num w-14 shrink-0 font-semibold text-[var(--text)]">{pct(o.rate)}</span>
								<span class="text-[var(--text-2)]">
									{o.when}
									{#if o.code && onpick}
										<button type="button" class="link ml-1 text-[12.5px]" onclick={() => onpick(o.code!)}>use {codeName(o.code)}</button>
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
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
							{#if g.rule.conditions.length && !(t.outcomes?.length && g.treatment === 'conditional')}
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
										<a class="link" href={c.archived ?? archived(c.url, c.quote)} target="_blank" rel="noopener" title="OpenTaxRate's archived copy, opening at the quoted sentence">{c.title}</a>
										<span class="text-[var(--text-muted)]">
											{#if offline(c.url)}
												· <span title="{c.url} was gone when checked on {offlineChecked}; the archived copy is the evidence">original (no longer online)</span>
											{:else}
												{#if c.page}<span> · p. {c.page}</span>{/if}
												· <a class="link" href={c.page ? `${c.url}#page=${c.page}` : c.url} target="_blank" rel="noopener" title="The page as published today; it may have changed">original ↗</a>
											{/if}
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
