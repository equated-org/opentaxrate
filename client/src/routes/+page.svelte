<script lang="ts">
	/**
	 * The one page. Empty, it's a search box and three examples; after a
	 * lookup the box moves up, the rate list sits left and the map right.
	 * The only state beyond the screen is ?q= in the URL, so a result can be
	 * shared; loading a URL with ?q= runs that search.
	 */
	import { page } from '$app/state';
	import { goto, pushState } from '$app/navigation';
	import { onMount } from 'svelte';
	import { ACCOUNTS, seemsSignedIn } from '$lib/accounts';
	import { lookUp, type LookupResult } from '$lib/api';
	import { EXAMPLES, GITHUB, SAME_ZIP } from '$lib/examples';
	import AccuracySummary from '$lib/landing/AccuracySummary.svelte';
	import Compare from '$lib/result/Compare.svelte';
	import Features from '$lib/landing/Features.svelte';
	import Showcase from '$lib/landing/Showcase.svelte';
	import ProgressStrip from '$lib/pixel/ProgressStrip.svelte';
	import SiteFooter from '$lib/landing/SiteFooter.svelte';
	import SiteNav from '$lib/landing/SiteNav.svelte';
	import Limited from '$lib/result/Limited.svelte';
	import RateList from '$lib/result/RateList.svelte';
	import Refusal from '$lib/result/Refusal.svelte';
	import AddressSearch from '$lib/search/AddressSearch.svelte';
	import { PARSE_HINT } from '$lib/search/parse';
	import { resolve, type Suggestion } from '$lib/search/suggest';
	import { stateName } from '$lib/states';
	import { theme } from '$lib/theme.svelte';

	// Signed in, the home page is the dashboard; a shared lookup (?q=) still
	// opens here.
	onMount(() => {
		if (seemsSignedIn() && !page.url.search) goto('/dashboard', { replaceState: true });
	});

	let text = $state('');
	let loading = $state(false);
	let result = $state<LookupResult | null>(null);
	let shown = $state<Suggestion | null>(null);
	/** Lookups side by side (?q=A&vs=B&vs=C), instead of one. */
	let pair = $state<{ suggestion: Suggestion; result: LookupResult | null }[] | null>(null);
	let hint = $state('');
	/** The ?q= (and &vs=) this page last acted on, so its own pushState isn't re-run. */
	let activeQ: string | null = null;
	let controller: AbortController | undefined;
	let mapModule = $state.raw<Promise<typeof import('$lib/result/TaxMap.svelte')>>();

	const fixture = () => (import.meta.env.DEV ? page.url.searchParams.get('fixture') : null);

	async function run(s: Suggestion | (() => Promise<Suggestion | null>)) {
		controller?.abort();
		const c = new AbortController();
		controller = c;
		loading = true;
		hint = '';
		pair = null;
		// The map's code starts loading with the first lookup, in parallel
		// with the API call; the empty page never fetches it.
		mapModule ??= import('$lib/result/TaxMap.svelte');
		try {
			const target = typeof s === 'function' ? await s() : s;
			if (c.signal.aborted) return;
			if (!target) {
				loading = false;
				return;
			}
			const r = await lookUp(
				{ state: target.state, street: target.street, city: target.city, zip: target.zip },
				c.signal,
				fixture()
			);
			if (c.signal.aborted) return;
			result = r;
			shown = target;
		} catch (error) {
			if (!c.signal.aborted) console.error(error);
		} finally {
			if (controller === c) loading = false;
		}
	}

	/** A known example's suggestion, or the text resolved by the search box's geocoder. */
	function known(q: string): Suggestion | undefined {
		const all = [...EXAMPLES.map((e) => e.suggestion), ...SAME_ZIP];
		return all.find((s) => s.label.toLowerCase() === q.trim().toLowerCase());
	}

	async function compare(texts: string[]) {
		controller?.abort();
		const c = new AbortController();
		controller = c;
		loading = true;
		hint = '';
		result = null;
		shown = null;
		text = '';
		try {
			const targets = await Promise.all(
				texts.map(async (q) => {
					const s = known(q);
					if (s) return s;
					const found = await resolve(q, c.signal);
					if (!found.ok) throw new Error(`${q}: ${PARSE_HINT[found.reason]}`);
					return found.suggestion;
				})
			);
			if (c.signal.aborted) return;
			pair = targets.map((suggestion) => ({ suggestion, result: null }));
			const results = await Promise.all(
				targets.map((t) => lookUp({ state: t.state, street: t.street, city: t.city, zip: t.zip }, c.signal, fixture()))
			);
			if (c.signal.aborted) return;
			pair = targets.map((suggestion, i) => ({ suggestion, result: results[i] }));
		} catch (error) {
			if (c.signal.aborted) return;
			hint = error instanceof Error ? error.message : String(error);
			pair = null;
		} finally {
			if (controller === c) loading = false;
		}
	}

	function openPair(list: Suggestion[]) {
		const labels = list.map((s) => s.label);
		activeQ = labels.join('\n');
		const url = new URL(page.url);
		url.searchParams.set('q', labels[0]);
		url.searchParams.delete('vs');
		for (const label of labels.slice(1)) url.searchParams.append('vs', label);
		pushState(url, {});
		compare(labels);
	}

	const compareHref = (list: Suggestion[]) =>
		'/?' + new URLSearchParams([['q', list[0].label], ...list.slice(1).map((s) => ['vs', s.label])]);

	function go(s: Suggestion) {
		text = s.label;
		activeQ = s.label;
		const url = new URL(page.url);
		url.searchParams.set('q', s.label);
		url.searchParams.delete('vs');
		pushState(url, {});
		run(s);
	}

	function fromText(q: string) {
		text = q;
		activeQ = q;
		const example = known(q);
		if (example) return run(example);
		run(async () => {
			const found = await resolve(q, controller!.signal);
			if (found.ok) return found.suggestion;
			hint = PARSE_HINT[found.reason];
			return null;
		});
	}

	function submit(q: string) {
		const url = new URL(page.url);
		url.searchParams.set('q', q);
		url.searchParams.delete('vs');
		pushState(url, {});
		fromText(q);
	}

	function reset() {
		controller?.abort();
		loading = false;
		result = null;
		shown = null;
		pair = null;
		text = '';
		hint = '';
		activeQ = null;
	}

	// Loading a shared link, and back/forward between lookups.
	$effect(() => {
		const q = page.url.searchParams.get('q');
		const vs = page.url.searchParams.getAll('vs').slice(0, 2);
		const key = q && vs.length ? [q, ...vs].join('\n') : q;
		if (key === activeQ) return;
		if (!q) return reset();
		activeQ = key;
		if (vs.length) {
			compare([q, ...vs]);
			return;
		}
		fromText(q);
	});

	function home(event: MouseEvent) {
		event.preventDefault();
		const url = new URL(page.url);
		url.searchParams.delete('q');
		url.searchParams.delete('vs');
		pushState(url, {});
		reset();
	}

	const trace = $derived(result && (result.kind === 'rate' || result.kind === 'refusal') ? result.trace : null);
	const fallback = $derived(
		shown && Number.isFinite(shown.lon) && Number.isFinite(shown.lat) ? { lon: shown.lon, lat: shown.lat, from: shown.from } : null
	);
	const showMap = $derived(
		!!result &&
			(result.kind === 'rate' || result.kind === 'refusal') &&
			(!!fallback || !!trace?.point || !!trace?.outlines.some((o) => o.geometry))
	);
	const inResult = $derived(result !== null || pair !== null);
</script>

{#if !inResult}
	<div class="flex min-h-dvh flex-col">
		<SiteNav onhome={home} />

		<main class="flex flex-1 flex-col">
			<section class="flex flex-col items-center px-5 pt-[4vh] pb-20 sm:pb-24">
				<img
					src="/hero-pin.webp"
					alt=""
					width="880"
					height="714"
					fetchpriority="high"
					class="h-auto w-[min(72vw,330px)] select-none"
				/>
				<h1 class="mt-4 text-center text-[36px] leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[48px]">
					Sales tax by street address.
				</h1>
				<p class="mt-4 max-w-[44rem] text-center text-[17px] text-balance leading-relaxed text-[var(--text-muted)]">
					Get the combined rate, jurisdiction breakdown, and source. Published government data, through one open-source API.
					<a
						href="/sources"
						class="underline underline-offset-4 hover:text-[var(--text)]"
					>See sources</a>
				</p>

				<div class="relative z-10 mt-10 w-full max-w-[640px]">
					<AddressSearch bind:value={text} onpick={go} onsubmit={submit} autofocus />
					<div class="mt-4 h-[6px] px-6">
						{#if loading}<ProgressStrip />{/if}
					</div>
					{#if hint}<p class="mt-1 text-center text-sm text-[var(--warn)]" role="alert">{hint}</p>{/if}
				</div>

				<div class="mt-5 flex flex-col items-center gap-3">
					<p class="text-sm text-[var(--text-muted)]">or try one</p>
					<ul class="flex flex-wrap justify-center gap-2">
						{#each EXAMPLES as e (e.name)}
							<li>
								<button type="button" class="chip" onclick={() => (e.compare ? openPair(e.compare) : go(e.suggestion))} title={e.suggestion.label}>
									{e.name}<span class="text-[var(--text-muted)]">· {e.note}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
				<div class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
					{#if ACCOUNTS}<a class="btn primary" href="/login">Get an API key <span aria-hidden="true">→</span></a>{/if}
					<a class="btn" href="/docs">Read the docs</a>
					<a
						href={GITHUB}
						target="_blank"
						rel="noopener"
						class="rounded text-sm text-[var(--text-muted)] underline-offset-4 hover:text-[var(--text)] hover:underline"
					>
						Open source · View on GitHub <span aria-hidden="true">↗</span>
					</a>
				</div>
			</section>

			<section class="px-4 sm:px-8" aria-label="What a lookup shows">
				<div class="relative mx-auto max-w-[1120px]">
					<Showcase
						addresses={SAME_ZIP}
						single={2}
						hrefs={{ single: `/?q=${encodeURIComponent(SAME_ZIP[2].label)}`, all: compareHref(SAME_ZIP) }}
						onopen={(which) => (which === 'single' ? go(SAME_ZIP[2]) : openPair(SAME_ZIP))}
					/>
				</div>
				<div class="mx-auto mt-20 max-w-[1120px] sm:mt-24">
					<Features />
				</div>
				<div class="mx-auto mt-20 max-w-[1120px] sm:mt-24">
					<AccuracySummary />
				</div>
			</section>
		</main>

		<SiteFooter />
	</div>
{:else}
	<div class="flex min-h-dvh flex-col">
		<SiteNav onhome={home}>
			{#snippet center()}
				<AddressSearch bind:value={text} onpick={go} onsubmit={submit} size="sm" />
			{/snippet}
			{#snippet below()}
				<div class="h-[6px]">{#if loading}<ProgressStrip cells={64} />{/if}</div>
			{/snippet}
		</SiteNav>

		{#if hint}<p class="px-6 pt-3 text-center text-sm text-[var(--warn)]" role="alert">{hint}</p>{/if}

		{#if pair}
		<main class="mx-auto w-full max-w-[1120px] flex-1 px-4 py-8 transition-opacity sm:px-6 {loading ? 'opacity-60' : ''}" aria-busy={loading}>
			<Compare {pair} onretry={() => pair && compare(pair.map((p) => p.suggestion.label))} />
		</main>
		{:else}
		<main
			class="grid flex-1 gap-6 px-4 py-6 transition-opacity sm:px-6 {loading ? 'opacity-60' : ''}
				{showMap ? 'lg:grid-cols-[minmax(340px,420px)_minmax(0,1fr)]' : 'mx-auto w-full max-w-[560px]'}"
			aria-busy={loading}
		>
			<div class="min-w-0">
				{#if shown}<p class="mb-5 text-sm break-words text-[var(--text-muted)]">{shown.label}</p>{/if}
				{#if result?.kind === 'rate'}
					<RateList rate={result.rate} trace={result.trace} url={result.url} raw={result.raw} />
				{:else if result?.kind === 'refusal'}
					<Refusal message={result.message} code={result.code} trace={result.trace} url={result.url} raw={result.raw} />
				{:else if result?.kind === 'limited'}
					<Limited message={result.message} retryAfter={result.retryAfter} onretry={() => shown && run(shown)} />
				{:else if result?.kind === 'failed'}
					<section class="flex flex-col gap-3">
						<h2 class="text-[17px] font-semibold">
							{result.status === 502 || result.status === 504 ? 'A data source is down' : "Couldn't get a rate"}
						</h2>
						<p class="text-sm leading-relaxed text-[var(--text-2)]">{result.message}</p>
						<div><button type="button" class="btn" onclick={() => shown && run(shown)}>Try again</button></div>
					</section>
				{/if}
			</div>

			{#if showMap && mapModule && result && (result.kind === 'rate' || result.kind === 'refusal')}
				<div class="h-[420px] min-w-0 lg:sticky lg:top-[104px] lg:h-[calc(100dvh-128px)]">
					{#await mapModule}
						<div class="h-full w-full rounded-2xl border border-[var(--border)] bg-[var(--bg-muted)]"></div>
					{:then { default: TaxMap }}
						<TaxMap
							{trace}
							parts={result.kind === 'rate' ? result.rate.parts : []}
							refused={result.kind === 'refusal'}
							match={result.kind === 'rate' ? result.rate.match : null}
							stateName={stateName(result.query.state)}
							{fallback}
							theme={theme.resolved}
						/>
					{:catch}
						<div class="grid h-full place-items-center rounded-2xl border border-[var(--border)] text-sm text-[var(--text-muted)]">
							The map couldn't load.
						</div>
					{/await}
				</div>
			{/if}
		</main>
		{/if}
	</div>
{/if}
