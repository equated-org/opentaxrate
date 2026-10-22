<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { account, buyCredit, dollars, perThousand, type RequestRow } from '$lib/auth';
	import { dashboard } from '$lib/dashboard.svelte';
	import RequestTable from '$lib/dashboard/RequestTable.svelte';

	let recent = $state<RequestRow[] | null>(null);
	let copied = $state(false);
	const s = $derived(dashboard.summary!);

	const CURL = `curl "https://api.opentaxrate.com/v1/rate?state=TX&street=301+W+2nd+St&city=Austin&zip=78701" \\
  -H "x-api-key: $OPENTAXRATE_KEY"`;

	const TOP_UPS = [1000, 2500, 5000];
	let buying = $state<number | null>(null);
	let notice = $state('');

	async function buy(cents: number) {
		buying = cents;
		notice = '';
		try {
			await buyCredit(cents);
		} catch (error) {
			notice = (error as Error).message;
			buying = null;
		}
	}

	/** Back from Checkout: the webhook credits within seconds; wait for it. */
	async function awaitPayment() {
		const before = dashboard.summary!.creditMicros;
		notice = 'Payment received. Adding your credit…';
		for (let i = 0; i < 10; i++) {
			await new Promise((r) => setTimeout(r, 1000));
			await dashboard.refresh();
			if (dashboard.summary!.creditMicros > before) {
				notice = 'Credit added.';
				break;
			}
		}
		if (notice !== 'Credit added.') notice = 'Your payment went through; the credit will show shortly.';
		history.replaceState(history.state, '', '/dashboard');
	}

	onMount(async () => {
		if (page.url.searchParams.get('paid')) awaitPayment();
		const rows = await account<{ requests: RequestRow[] }>('requests');
		recent = rows?.requests.slice(0, 4) ?? [];
	});

	async function copy() {
		await navigator.clipboard.writeText(CURL);
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}
</script>

<h1 class="text-[30px] leading-tight font-semibold tracking-tight">Home</h1>
<p class="mt-1.5 mb-7 max-w-[46rem] text-[14.5px] text-[var(--text-muted)]">
	Lookups with your key use every geocoder we have; without one, only ours.
</p>

<section class="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] p-5 shadow-[var(--shadow)]">
	<div class="flex flex-wrap items-center gap-4">
		<p class="min-w-[260px] flex-1">
			<b class="font-num text-[26px] font-semibold">{dollars(s.creditMicros)}</b>
			<span class="text-[var(--text-muted)]">
				credit, about <span class="font-num">{s.lookupsLeft.toLocaleString()}</span> lookups at {perThousand(s.priceMicros)} per 1,000</span
			>
		</p>
		{#if s.canBuy}
			<div class="flex items-center gap-2">
				<span class="text-[13px] text-[var(--text-muted)]">Add</span>
				{#each TOP_UPS as cents (cents)}
					<button class={cents === 1000 ? 'btn primary' : 'btn'} disabled={buying !== null} onclick={() => buy(cents)}>
						{buying === cents ? 'Opening…' : `$${cents / 100}`}
					</button>
				{/each}
			</div>
		{:else}
			<span class="btn" aria-disabled="true" title="Buying credit opens soon">Add credit</span>
		{/if}
	</div>
	{#if notice}<p class="mt-3 text-[13px] text-[var(--text-2)]" role="status">{notice}</p>{/if}
	<p class="mt-3 text-[13px] text-[var(--text-muted)]">
		This month: <span class="font-num">{s.month.charged.toLocaleString()}</span> lookups charged,
		<span class="font-num">{s.month.declined.toLocaleString()}</span> declined and not charged.
	</p>
</section>

<section class="mt-9">
	<div class="mb-3 flex items-baseline gap-3">
		<h2 class="text-[17px] font-semibold">Make a request</h2>
		<a class="ml-auto text-[13px] text-[var(--text-muted)] underline underline-offset-3" href="/dashboard/keys">Get a key</a>
	</div>
	<div class="relative">
		<pre class="code">{CURL}</pre>
		<button class="btn absolute top-2 right-2 px-2.5 py-1 text-[12.5px]" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
	</div>
</section>

<section class="mt-9">
	<div class="mb-3 flex items-baseline gap-3">
		<h2 class="text-[17px] font-semibold">Recent lookups</h2>
		<a class="ml-auto text-[13px] text-[var(--text-muted)] underline underline-offset-3" href="/dashboard/history">All history</a>
	</div>
	{#if recent}<RequestTable rows={recent} />{/if}
</section>

<style>
	.code {
		margin: 0;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg-muted);
		padding: 14px 16px;
		padding-right: 80px;
		font-family: var(--font-mono);
		font-size: 12.8px;
		line-height: 1.7;
	}
</style>
