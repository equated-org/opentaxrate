<script lang="ts">
	import TryIt from './TryIt.svelte';

	/** GET /v1/rate to try: the address as one line or as fields. */
	let form = $state<'line' | 'fields'>('line');
	let address = $state('1410 E Pine St, Seattle, WA 98122');
	let fields = $state({ state: 'WA', street: '1410 E Pine St', city: 'Seattle', zip: '98122' });

	const query = $derived.by(() => {
		if (form === 'line') return new URLSearchParams({ address }).toString();
		const { zip, ...rest } = fields;
		return new URLSearchParams(zip ? { ...rest, zip } : rest).toString();
	});
</script>

<TryIt path="/v1/rate" {query}>
	<div class="tabs" role="tablist" aria-label="Address as">
		<button type="button" role="tab" aria-selected={form === 'line'} onclick={() => (form = 'line')}>One line</button>
		<button type="button" role="tab" aria-selected={form === 'fields'} onclick={() => (form = 'fields')}>Fields</button>
	</div>
	{#if form === 'line'}
		<label>address<input bind:value={address} required /></label>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-[4rem_1fr_1fr_6rem]">
			<label>state<input bind:value={fields.state} maxlength="2" required /></label>
			<label class="col-span-2 sm:col-span-1">street<input bind:value={fields.street} /></label>
			<label>city<input bind:value={fields.city} /></label>
			<label>zip<input bind:value={fields.zip} /></label>
		</div>
	{/if}
</TryIt>

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
	.tabs {
		display: flex;
		gap: 0.25rem;
		font-size: 13px;
	}
	.tabs button {
		border-radius: 999px;
		padding: 0.2rem 0.75rem;
		color: var(--text-muted);
	}
	.tabs button[aria-selected='true'] {
		background: var(--bg-muted);
		color: var(--text);
		font-weight: 500;
	}
</style>
