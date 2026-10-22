<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth';
	import { copyText } from '$lib/clipboard';
	import { dashboard } from '$lib/dashboard.svelte';

	interface Key {
		id: string;
		name: string | null;
		start: string | null;
		createdAt: string | Date;
		lastRequest: string | Date | null;
	}

	let keys = $state<Key[]>([]);
	let dialog: HTMLDialogElement;
	let name = $state('');
	let creating = $state(false);
	let createError = $state('');
	let revealed = $state<string | null>(null);
	let copied = $state(false);
	let error = $state('');

	const day = (d: string | Date) => new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
	const ago = (d: string | Date | null) => {
		if (!d) return 'Never';
		const minutes = Math.round((Date.now() - new Date(d).getTime()) / 60_000);
		if (minutes < 1) return 'Just now';
		if (minutes < 60) return `${minutes} min ago`;
		if (minutes < 1440) return `${Math.round(minutes / 60)} h ago`;
		return day(d);
	};

	async function load() {
		const { data, error: failed } = await authClient.apiKey.list();
		if (failed) error = failed.message ?? "Your keys couldn't load.";
		else keys = (data?.apiKeys ?? []) as Key[];
	}
	onMount(load);

	function openDialog() {
		name = '';
		revealed = null;
		createError = '';
		copied = false;
		dialog.showModal();
	}

	/** The key is only ever in memory here, so closing forgets it. */
	function cancel(event: Event) {
		// Escape while creating would close before the key arrives.
		if (creating) event.preventDefault();
	}

	function closed() {
		revealed = null;
		name = '';
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		createError = '';
		creating = true;
		const { data, error: failed } = await authClient.apiKey.create({ name: name.trim() || 'untitled' });
		creating = false;
		if (failed || !data) {
			createError = failed?.message ?? "The key couldn't be created.";
			return;
		}
		revealed = data.key;
		// Escape can still get through (browsers let a second press past
		// preventDefault), so bring the dialog back to show the key.
		if (!dialog.open) dialog.showModal();
		await load();
	}

	async function revoke(key: Key) {
		if (!confirm(`Revoke "${key.name ?? key.start}"? Requests with it will get a 401 right away.`)) return;
		const { error: failed } = await authClient.apiKey.delete({ keyId: key.id });
		if (failed) error = failed.message ?? "The key couldn't be revoked.";
		await load();
	}

	async function copy() {
		if (!(await copyText(revealed!))) {
			prompt('Copy your key', revealed!);
			return;
		}
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}
</script>

<div class="flex flex-wrap items-start gap-4">
	<div class="min-w-[260px] flex-1">
		<h1 class="text-[30px] leading-tight font-semibold tracking-tight">API keys</h1>
		<p class="mt-1.5 mb-7 max-w-[46rem] text-[14.5px] text-[var(--text-muted)]">
			Send a key as <code>x-api-key</code> or <code>Authorization: Bearer</code>. Keep keys on your server; anyone with one can use your
			lookups.
		</p>
	</div>
	<button class="btn primary" onclick={openDialog}>New key</button>
</div>

<dialog bind:this={dialog} oncancel={cancel} onclose={closed} class="modal" aria-labelledby="new-key-title">
	{#if revealed}
		<h2 id="new-key-title" class="text-[17px] font-semibold">Copy your key now</h2>
		<p class="mt-1.5 mb-4 text-[13.5px] text-[var(--text-muted)]">We only keep a hash, so it can't be shown again.</p>
		<code class="block rounded-[10px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 break-all">{revealed}</code>
		<div class="mt-5 flex justify-end gap-2">
			<button class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
			<button class="btn primary" onclick={() => dialog.close()}>Done</button>
		</div>
		<span class="sr-only" aria-live="polite">{copied ? 'Copied the key' : ''}</span>
	{:else}
		<form onsubmit={create}>
			<h2 id="new-key-title" class="text-[17px] font-semibold">New key</h2>
			<p class="mt-1.5 mb-4 text-[13.5px] text-[var(--text-muted)]">Name it for where it runs, so you know which to revoke.</p>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={name}
				placeholder="Name, e.g. production"
				aria-label="Key name"
				maxlength="32"
				autofocus
				class="w-full rounded-[9.6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13.5px]"
			/>
			{#if createError}<p class="mt-3 text-[13px] text-[var(--warn)]" role="alert">{createError}</p>{/if}
			<div class="mt-5 flex justify-end gap-2">
				<button type="button" class="btn" disabled={creating} onclick={() => dialog.close()}>Cancel</button>
				<button class="btn primary" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
			</div>
		</form>
	{/if}
</dialog>

{#if error}<p class="mb-3 text-[13px] text-[var(--warn)]" role="alert">{error}</p>{/if}

<div class="card overflow-x-auto">
	<table class="w-full border-collapse text-left text-[13.5px]">
		<thead>
			<tr class="border-b border-[var(--border-strong)] text-[12.5px] text-[var(--text-muted)]">
				<th class="px-3 pt-3 pb-2 font-medium">Name</th>
				<th class="px-3 pt-3 pb-2 font-medium">Key</th>
				<th class="px-3 pt-3 pb-2 font-medium">Created</th>
				<th class="px-3 pt-3 pb-2 font-medium">Last used</th>
				<th class="px-3 pt-3 pb-2 text-right font-medium">This month</th>
				<th class="px-3 pt-3 pb-2"><span class="sr-only">Revoke</span></th>
			</tr>
		</thead>
		<tbody>
			{#each keys as key (key.id)}
				<tr class="border-t border-[var(--border)] first:border-t-0">
					<th class="px-3 py-2.5 font-medium">{key.name ?? 'untitled'}</th>
					<td class="font-num px-3 py-2.5 text-[var(--text-muted)]">{key.start}…</td>
					<td class="px-3 py-2.5 text-[var(--text-muted)]">{day(key.createdAt)}</td>
					<td class="px-3 py-2.5 text-[var(--text-muted)]">{ago(key.lastRequest)}</td>
					<td class="font-num px-3 py-2.5 text-right">{(dashboard.summary?.lookupsByKey[key.id] ?? 0).toLocaleString()}</td>
					<td class="px-3 py-2.5 text-right"><button class="btn danger px-2.5 py-1 text-[12.5px]" onclick={() => revoke(key)}>Revoke</button></td>
				</tr>
			{:else}
				<tr><td colspan="6" class="px-3 py-6 text-center text-[var(--text-muted)]">No keys yet. Create one to start.</td></tr>
			{/each}
		</tbody>
	</table>
</div>
<p class="mt-3 text-[12.5px] text-[var(--text-muted)]">Each key can make 120 lookups a minute. All keys share the account's lookups.</p>

<style>
	.card {
		border: 1px solid var(--border);
		border-radius: var(--radius-card);
		background: var(--card);
		box-shadow: var(--shadow);
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
