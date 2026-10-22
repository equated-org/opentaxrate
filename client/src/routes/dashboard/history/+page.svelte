<script lang="ts">
	import { onMount } from 'svelte';
	import { account, authClient, type RequestRow } from '$lib/auth';
	import RequestTable from '$lib/dashboard/RequestTable.svelte';

	let rows = $state<RequestRow[]>([]);
	let next = $state<number | null>(null);
	let search = $state('');
	let keyId = $state('');
	let result = $state('');
	let keys = $state<Array<{ id: string; name: string | null }>>([]);
	const keyNames = $derived(Object.fromEntries(keys.map((k) => [k.id, k.name ?? 'untitled'])));

	function query(before?: number) {
		const p = new URLSearchParams();
		if (search.trim()) p.set('q', search.trim());
		if (keyId) p.set('key', keyId);
		if (result) p.set('result', result);
		if (before) p.set('before', String(before));
		return `requests?${p}`;
	}

	async function load(more = false) {
		const page = await account<{ requests: RequestRow[]; next: number | null }>(query(more ? next! : undefined));
		if (!page) return;
		rows = more ? [...rows, ...page.requests] : page.requests;
		next = page.next;
	}

	let timer: ReturnType<typeof setTimeout>;
	const searchSoon = () => {
		clearTimeout(timer);
		timer = setTimeout(() => load(), 250);
	};

	onMount(async () => {
		const { data } = await authClient.apiKey.list();
		keys = (data?.apiKeys ?? []) as typeof keys;
		await load();
	});
</script>

<h1 class="text-[30px] leading-tight font-semibold tracking-tight">History</h1>
<p class="mt-1.5 mb-7 max-w-[46rem] text-[14.5px] text-[var(--text-muted)]">
	Every lookup made with your keys over the last 90 days. Click one to see the full response.
</p>

<div class="mb-3.5 flex flex-wrap items-center gap-2">
	<input
		type="search"
		placeholder="Search addresses"
		aria-label="Search addresses"
		bind:value={search}
		oninput={searchSoon}
		class="field min-w-[240px] flex-1"
	/>
	<select aria-label="Key" bind:value={keyId} onchange={() => load()} class="field">
		<option value="">All keys</option>
		{#each keys as key (key.id)}<option value={key.id}>{key.name ?? 'untitled'}</option>{/each}
	</select>
	<select aria-label="Result" bind:value={result} onchange={() => load()} class="field">
		<option value="">All results</option>
		<option value="rate">Rate</option>
		<option value="declined">Declined</option>
		<option value="error">Errors</option>
	</select>
</div>

<RequestTable {rows} detail {keyNames} />

{#if next}
	<div class="mt-3 flex justify-end"><button class="btn px-3 py-1 text-[12.5px]" onclick={() => load(true)}>Older lookups</button></div>
{/if}

<style>
	.field {
		border: 1px solid var(--border);
		border-radius: 9.6px;
		background: var(--surface);
		color: var(--text);
		padding: 7px 11px;
		font-size: 13.5px;
	}
	/* The native arrow sits against the edge; draw one with the same inset as the text. */
	select.field {
		appearance: none;
		padding-right: 32px;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M1 1l4 4 4-4'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
	}
</style>
