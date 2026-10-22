<script lang="ts">
	import { apiBase } from '$lib/api';
	import { copyText } from '$lib/clipboard';

	/** A live GET /v1/rate from the docs: edit the address, see the curl, send it
	 *  and show the body as it came. The page's own origin answers only unkeyed
	 *  lookups (limited per IP, as on the home page), so the key stays in the curl. */
	let address = $state('1410 E Pine St, Seattle, WA 98122');

	let status = $state<number | null>(null);
	let body = $state<string | null>(null);
	let sending = $state(false);
	let copied = $state(false);

	const query = $derived(new URLSearchParams({ address }).toString());
	const curl = $derived(
		`curl "https://api.opentaxrate.com/v1/rate?${query}" \\\n  -H "Authorization: Bearer otr_live_..."`
	);

	async function send(event: SubmitEvent) {
		event.preventDefault();
		sending = true;
		try {
			const url = new URL(`${apiBase()}/v1/rate?${query}`, location.origin);
			const response = await fetch(url, { headers: { accept: 'application/json' } });
			status = response.status;
			const text = await response.text();
			try {
				body = JSON.stringify(JSON.parse(text), null, 2);
			} catch {
				body = text || '(empty body)';
			}
		} catch (error) {
			status = null;
			body = `Request failed: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			sending = false;
		}
	}

	async function copy() {
		copied = await copyText(curl);
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div class="try mt-4 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
	<form class="flex flex-col gap-3 p-4" onsubmit={send}>
		<label>address<input bind:value={address} required /></label>
		<div class="flex items-center justify-between gap-4">
			<p class="text-xs text-[var(--text-muted)]">Sent from this page without a key, limited per IP address.</p>
			<button
				class="btn primary shrink-0"
				disabled={sending}>{sending ? 'Sending…' : 'Send request'}</button
			>
		</div>
	</form>

	<div class="border-t border-[var(--border)]">
		<div class="flex items-center justify-between px-4 pt-3 pb-1">
			<p class="text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">Request</p>
			<button class="text-xs text-[var(--text-muted)] hover:text-[var(--text)]" type="button" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
		</div>
		<pre class="request"><code>{curl}</code></pre>
	</div>

	{#if body !== null}
		<div class="border-t border-[var(--border)]">
			<p class="px-4 pt-3 pb-1 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase">
				Response{status ? ` · ${status}` : ''}
			</p>
			<pre class="response"><code>{body}</code></pre>
		</div>
	{/if}
</div>

<style>
	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-family: 'Geist Mono Variable', ui-monospace, monospace;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-2);
	}
	input {
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--bg);
		padding: 0.4rem 0.6rem;
		font-family: inherit;
		font-size: 13px;
		font-weight: 400;
		color: var(--text);
	}
	.try p {
		margin: 0;
		color: var(--text-muted);
	}
	.try pre:is(.request, .response) {
		margin: 0;
		border: none;
		border-radius: 0;
	}
	.response {
		max-height: 28rem;
		overflow-y: auto;
		background: var(--surface);
	}
</style>
