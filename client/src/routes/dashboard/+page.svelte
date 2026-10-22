<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { account, buyCredit, confirmPayment, perThousand, type RequestRow } from '$lib/auth';
	import { copyText } from '$lib/clipboard';
	import { dashboard } from '$lib/dashboard.svelte';
	import RequestTable from '$lib/dashboard/RequestTable.svelte';

	let recent = $state<RequestRow[] | null>(null);
	let copied = $state(false);
	const s = $derived(dashboard.summary!);

	const CURL = `curl "https://api.opentaxrate.com/v1/rate?state=TX&street=301+W+2nd+St&city=Austin&zip=78701" \\
  -H "x-api-key: $OPENTAXRATE_KEY"`;

	const TOP_UPS = [1000, 2500, 5000];
	let dialog = $state<HTMLDialogElement>();
	let dollars = $state<number | null>(10);
	let buying = $state(false);
	let buyError = $state('');
	let notice = $state('');
	const cents = $derived(dollars === null ? null : Math.round(dollars * 100));
	const amountOk = $derived(
		cents !== null && Number.isInteger(dollars) && cents >= s.topUpCents.min && cents <= s.topUpCents.max
	);

	function openBuy() {
		dollars = 10;
		buyError = '';
		dialog?.showModal();
	}

	async function buy(event: SubmitEvent) {
		event.preventDefault();
		if (!amountOk) return;
		buying = true;
		buyError = '';
		try {
			await buyCredit(cents!);
		} catch (error) {
			buyError = (error as Error).message;
			buying = false;
		}
	}

	/** Back from Checkout: ask Stripe about the session, again for a few
	 *  seconds if it isn't paid yet (the webhook credits it too, if set up).
	 *  The session stays in the URL until it's confirmed, so a reload or
	 *  Retry can still credit it. */
	let unconfirmed = $state<string | null>(null);
	async function awaitPayment(session: string) {
		unconfirmed = null;
		notice = 'Payment received. Adding your lookups…';
		for (let i = 0; i < 6; i++) {
			if (await confirmPayment(session).catch(() => false)) {
				await dashboard.refresh();
				notice = 'Lookups added.';
				history.replaceState(history.state, '', '/dashboard');
				return;
			}
			if (i < 5) await new Promise((r) => setTimeout(r, 1500));
		}
		notice = "We couldn't confirm your payment yet. If Stripe charged you, your lookups aren't lost.";
		unconfirmed = session;
	}

	onMount(async () => {
		const paid = page.url.searchParams.get('paid');
		if (paid) awaitPayment(paid);
		const rows = await account<{ requests: RequestRow[] }>('requests');
		recent = rows?.requests.slice(0, 4) ?? [];
	});

	async function copy() {
		if (!(await copyText(CURL))) {
			prompt('Copy this command', CURL);
			return;
		}
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
			<b class="font-num text-[26px] font-semibold">{s.lookupsLeft.toLocaleString()}</b>
			<span class="text-[var(--text-muted)]">{s.lookupsLeft === 1 ? 'lookup' : 'lookups'} left, at {perThousand(s.priceMicros)} per 1,000</span>
		</p>
		{#if s.canBuy}
			<button class="btn primary" onclick={openBuy}>Add lookups</button>
		{:else}
			<span class="btn" aria-disabled="true" title="Buying lookups opens soon">Add lookups</span>
		{/if}
	</div>
	{#if notice}
		<p class="mt-3 text-[13px] text-[var(--text-2)]" role="status">
			{notice}
			{#if unconfirmed}
				<button class="ml-1 underline underline-offset-3" onclick={() => awaitPayment(unconfirmed!)}>Try again</button>
			{/if}
		</p>
	{/if}
	<p class="mt-3 text-[13px] text-[var(--text-muted)]">
		This month: <span class="font-num">{s.month.charged.toLocaleString()}</span>
		{s.month.charged === 1 ? 'lookup' : 'lookups'} charged,
		<span class="font-num">{s.month.declined.toLocaleString()}</span> declined and not charged.
	</p>
</section>

{#if s.canBuy}
	<dialog bind:this={dialog} class="modal" aria-labelledby="buy-title">
		<form onsubmit={buy}>
			<h2 id="buy-title" class="text-[17px] font-semibold">Add lookups</h2>
			<p class="mt-1.5 mb-4 text-[13.5px] text-[var(--text-muted)]">
				{perThousand(s.priceMicros)} per 1,000, paid once through Stripe. Declined lookups aren't charged.
			</p>
			<div class="flex flex-wrap items-center gap-2">
				{#each TOP_UPS as preset (preset)}
					<button
						type="button"
						class="btn"
						aria-pressed={cents === preset}
						onclick={() => (dollars = preset / 100)}>${preset / 100}</button
					>
				{/each}
				<label class="amount">
					<span aria-hidden="true">$</span>
					<input
						type="number"
						inputmode="numeric"
						min={s.topUpCents.min / 100}
						max={s.topUpCents.max / 100}
						step="1"
						aria-label="Amount in dollars"
						bind:value={dollars}
					/>
				</label>
			</div>
			<p class="mt-3 text-[13px] {amountOk || dollars === null ? 'text-[var(--text-muted)]' : 'text-[var(--warn)]'}">
				{#if amountOk}
					Buys <span class="font-num">{Math.floor((cents! * 10_000) / s.priceMicros).toLocaleString()}</span> lookups.
				{:else}
					Whole dollars from ${s.topUpCents.min / 100} to ${(s.topUpCents.max / 100).toLocaleString()}.
				{/if}
			</p>
			{#if buyError}<p class="mt-3 text-[13px] text-[var(--warn)]" role="alert">{buyError}</p>{/if}
			<div class="mt-5 flex justify-end gap-2">
				<button type="button" class="btn" onclick={() => dialog?.close()}>Cancel</button>
				<button class="btn primary" disabled={!amountOk || buying}>{buying ? 'Opening Stripe…' : amountOk ? `Pay $${dollars}` : 'Pay'}</button>
			</div>
		</form>
	</dialog>
{/if}

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
	.amount {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		border: 1px solid var(--border);
		border-radius: 9.6px;
		background: var(--surface);
		padding: 0 10px;
		font-size: 13.5px;
		color: var(--text-muted);
	}
	.btn[aria-pressed='true'] {
		border-color: var(--text);
		color: var(--text);
	}
	.amount:focus-within {
		border-color: var(--border-strong);
	}
	.amount input {
		width: 5rem;
		border: 0;
		background: transparent;
		padding: 7px 0;
		color: var(--text);
		outline: none;
		appearance: textfield;
	}
	.amount input::-webkit-inner-spin-button,
	.amount input::-webkit-outer-spin-button {
		appearance: none;
		margin: 0;
	}
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
