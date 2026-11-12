<script lang="ts">
	/** The pages the taxability rules cite, by place: each linked to its
	 *  captures in the evidence archive first, the original second. A page
	 *  that's gone (offline-originals.json) links to its captures only. */
	import { captures, EVIDENCE, offline, offlineChecked, type PlaceSources } from '$lib/evidence';

	let { places }: { places: PlaceSources[] } = $props();
	const pageCount = $derived(places.reduce((n, p) => n + p.pages.length, 0));
	const ruleCount = $derived(places.reduce((n, p) => n + p.rules, 0));
	const host = (url: string) => new URL(url).hostname.replace(/^www\./, '');
	// A place's pages are drawn once it's first opened, which keeps the
	// prerendered page small; the data for every place is already loaded.
	let opened = $state<Record<string, boolean>>({});
</script>

<section class="mt-12" aria-labelledby="taxability-sources-heading">
	<h2 id="taxability-sources-heading" class="mb-3 text-xl leading-snug font-semibold">Taxability rules</h2>
	<p class="mb-4 leading-relaxed text-[var(--text-2)]">
		A rule says how one kind of sale is taxed in one place: whether groceries, software or a
		service is taxed, exempt or taxed at its own rate, and from what date. Every rule cites the
		official page it was read from and quotes the sentence it rests on. We keep a copy of each page,
		stored under a fingerprint of its contents, in our
		<a class="link" href={EVIDENCE} target="_blank" rel="noopener">evidence archive</a>, so a page
		can’t change without it showing. When an agency updates a page, the new version is archived
		beside the old one.
	</p>
	<p class="mb-6 text-sm leading-relaxed text-[var(--text-muted)]">
		{ruleCount.toLocaleString('en-US')} rules citing {pageCount.toLocaleString('en-US')} pages across
		{places.length} places. <a class="link" href="/docs/taxability">See the codes</a> they cover.
	</p>
	<div class="border-t border-[var(--border-strong)] text-sm leading-relaxed">
		{#each places as p (p.place)}
			<details class="border-b border-[var(--border)]" ontoggle={(e) => e.currentTarget.open && (opened[p.place] = true)}>
				<summary class="cursor-pointer py-3 font-medium hover:text-[var(--text)]">
					{p.name}
					<span class="ml-2 text-[13px] font-normal text-[var(--text-muted)]">{p.pages.length} page{p.pages.length === 1 ? '' : 's'} · {p.rules} rule{p.rules === 1 ? '' : 's'}</span>
				</summary>
				{#if opened[p.place]}
					<ul class="flex flex-col gap-2.5 pb-4">
						{#each p.pages as page (page.url)}
							<li class="text-[var(--text-2)]">
								<a class="link" href={captures(page.url)} target="_blank" rel="noopener" title="OpenTaxRate's archived copies of this page">{page.title}</a>
								<span class="block text-[13px] text-[var(--text-muted)]">
									{host(page.url)} ·
									{#if offline(page.url)}<span title="{page.url} was gone when checked on {offlineChecked}">no longer online</span>{:else}<a class="link" href={page.url} target="_blank" rel="noopener" title="The page as published today; it may have changed">original ↗</a>{/if}
									· cited by {page.rules} rule{page.rules === 1 ? '' : 's'}
								</span>
							</li>
						{/each}
					</ul>
				{/if}
			</details>
		{/each}
	</div>
</section>
