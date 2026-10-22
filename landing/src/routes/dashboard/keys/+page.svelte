<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient } from '$lib/auth';
	import { dashboard } from '$lib/dashboard.svelte';

	interface Key {
		id: string;
		name: string | null;
		start: string | null;
		createdAt: string | Date;
		lastRequest: string | Date | null;
	}

	let keys = $state<Key[]>([]);
	let naming = $state(false);
	let name = $state('');
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

	async function create(event: SubmitEvent) {
		event.preventDefault();
		error = '';
		const { data, error: failed } = await authClient.apiKey.create({ name: name.trim() || 'untitled' });
		if (failed || !data) {
			error = failed?.message ?? "The key couldn't be created.";
			return;
		}
		revealed = data.key;
		naming = false;
		name = '';
		await load();
	}

	async function revoke(key: Key) {
		if (!confirm(`Revoke "${key.name ?? key.start}"? Requests with it will get a 401 right away.`)) return;
		const { error: failed } = await authClient.apiKey.delete({ keyId: key.id });
		if (failed) error = failed.message ?? "The key couldn't be revoked.";
		await load();
	}

	async function copy() {
		await navigator.clipboard.writeText(revealed!);
		copied = true;
		setTimeout(() => (copied = false), 1200);
	}
</script>

<div class="flex flex-wrap items-start gap-4">
	<div class="min-w-[260px] flex-1">
		<h1 class="text-[30px] leading-tight font-semibold tracking-tight">API keys</h1>
		<p class="mt-1.5 mb-7 max-w-[46rem] text-[14.5px] text-[var(--text-muted)]">
			Send a key as <code>x-api-key</code> or <code>Authorization: Bearer</code>. Keep keys on your server; anyone with one can spend your
			credit.
		</p>
	</div>
	<button class="btn primary" onclick={() => ((naming = true), (revealed = null))}>New key</button>
</div>

{#if naming}
	<form class="card mb-4 flex flex-wrap items-center gap-2 p-4" onsubmit={create}>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:value={name}
			placeholder="Name, e.g. production"
			maxlength="32"
			autofocus
			class="min-w-[240px] rounded-[9.6px] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[13.5px]"
		/>
		<button class="btn primary">Create</button>
		<button type="button" class="btn" onclick={() => (naming = false)}>Cancel</button>
	</form>
{/if}

{#if revealed}
	<div class="card mb-4 border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] p-4">
		<p class="mb-2.5 text-[var(--text-2)]">
			<b class="text-[var(--text)]">Copy your key now.</b> We only keep a hash, so it can't be shown again.
		</p>
		<div class="flex flex-wrap items-center gap-2">
			<code class="min-w-[260px] flex-1 rounded-[10px] border border-[var(--border)] bg-[var(--bg-muted)] px-3 py-2 break-all">{revealed}</code>
			<button class="btn" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
			<button class="btn" onclick={() => (revealed = null)}>Done</button>
		</div>
	</div>
{/if}

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
<p class="mt-3 text-[12.5px] text-[var(--text-muted)]">Each key can make 120 lookups a minute. All keys draw from the account's credit.</p>

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
