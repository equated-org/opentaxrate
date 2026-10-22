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
	import { EXAMPLES, GITHUB } from '$lib/examples';
	import AccuracySummary from '$lib/landing/AccuracySummary.svelte';
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
	let hint = $state('');
	/** The ?q= this page last acted on, so its own pushState isn't re-run. */
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

	function go(s: Suggestion) {
		text = s.label;
		activeQ = s.label;
		const url = new URL(page.url);
		url.searchParams.set('q', s.label);
		pushState(url, {});
		run(s);
	}

	function fromText(q: string) {
		text = q;
		activeQ = q;
		const example = EXAMPLES.find((e) => e.suggestion.label.toLowerCase() === q.trim().toLowerCase());
		if (example) return run(example.suggestion);
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
		pushState(url, {});
		fromText(q);
	}

	function reset() {
		controller?.abort();
		loading = false;
		result = null;
		shown = null;
		text = '';
		hint = '';
		activeQ = null;
	}

	// Loading a shared link, and back/forward between lookups.
	$effect(() => {
		const q = page.url.searchParams.get('q');
		if (q === activeQ) return;
		if (!q) return reset();
		fromText(q);
	});

	function home(event: MouseEvent) {
		event.preventDefault();
		const url = new URL(page.url);
		url.searchParams.delete('q');
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
	const inResult = $derived(result !== null);
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
					One API key. Sales tax by address.
				</h1>
				<p class="mt-4 max-w-[44rem] text-center text-[17px] text-balance leading-relaxed text-[var(--text-muted)]">
					Accurate US sales tax rates from official state sources, through one open-source API.
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
								<button type="button" class="chip" onclick={() => go(e.suggestion)} title={e.suggestion.label}>
									{e.name}<span class="text-[var(--text-muted)]">· {e.note}</span>
								</button>
							</li>
						{/each}
					</ul>
				</div>
				<div class="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-3">
					{#if ACCOUNTS}<a class="btn primary" href="/login">Get an API key <span aria-hidden="true">→</span></a>{/if}
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
					<Showcase label={EXAMPLES[0].suggestion.label} href="/?q={encodeURIComponent(EXAMPLES[0].suggestion.label)}" onopen={() => go(EXAMPLES[0].suggestion)} />
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
	</div>
{/if}
