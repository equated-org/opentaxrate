<script lang="ts">
	/** Lookups made with the account's keys: when, where, the rate and how
	 *  it was found. With `detail`, a row opens to its full response. */
	import type { RequestRow } from '$lib/auth';

	let { rows, detail = false, keyNames = {} }: { rows: RequestRow[]; detail?: boolean; keyNames?: Record<string, string> } = $props();
	let open = $state<number | null>(null);

	const MATCH: Record<string, string> = {
		map: 'Map',
		street: 'Street',
		zip4: 'ZIP+4',
		zip5: 'ZIP',
		statewide: 'Statewide',
		authority: 'Authority'
	};
	function result(r: RequestRow): [string, string] {
		if (r.status === 200) return ['ok', MATCH[String(r.response.match)] ?? 'Rate'];
		if (r.status === 422) return ['warn', 'Declined'];
		return ['err', `Error ${r.status}`];
	}
	const when = (iso: string) => {
		const d = new Date(iso);
		const today = new Date().toDateString() === d.toDateString();
		const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
		return today ? `Today ${time}` : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
	};
	const pct = (r: RequestRow) =>
		r.status === 200 && typeof r.response.rate === 'number' ? `${+(r.response.rate * 100).toFixed(4)}%` : '—';
	const place = (q: Record<string, string>) => [q.city, [q.state, q.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
	const cols = $derived(detail ? 6 : 4);
</script>

<div class="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow)]">
	<table class="w-full border-collapse text-left text-[13.5px]">
		<thead>
			<tr class="border-b border-[var(--border-strong)] text-[12.5px] text-[var(--text-muted)]">
				<th class="px-3 pt-3 pb-2 font-medium">Time</th>
				<th class="px-3 pt-3 pb-2 font-medium">Address</th>
				{#if detail}<th class="px-3 pt-3 pb-2 font-medium">Key</th>{/if}
				<th class="px-3 pt-3 pb-2 text-right font-medium">Rate</th>
				<th class="px-3 pt-3 pb-2 font-medium">Result</th>
				{#if detail}<th class="px-3 pt-3 pb-2 text-right font-medium">Charged</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each rows as r (r.id)}
				{@const [tone, label] = result(r)}
				<tr
					class="border-t border-[var(--border)] first:border-t-0 {detail ? 'cursor-pointer hover:bg-[var(--bg-muted)]' : ''}"
					onclick={() => detail && (open = open === r.id ? null : r.id)}
					onkeydown={(e) => detail && e.key === 'Enter' && (open = open === r.id ? null : r.id)}
					tabindex={detail ? 0 : undefined}
				>
					<td class="font-num px-3 py-2.5 whitespace-nowrap text-[var(--text-muted)]">{when(r.at)}</td>
					<td class="px-3 py-2.5">
						<span class="block text-[var(--text)]">{r.query.street || '—'}</span>
						<span class="block text-[12px] text-[var(--text-muted)]">{place(r.query)}</span>
					</td>
					{#if detail}<td class="px-3 py-2.5 text-[var(--text-muted)]">{keyNames[r.keyId] ?? 'deleted key'}</td>{/if}
					<td class="font-num px-3 py-2.5 text-right">{pct(r)}</td>
					<td class="px-3 py-2.5">
						<span class="pill {tone}">{label}</span>
						{#if r.cached}<span class="ml-1 text-[11.5px] text-[var(--text-muted)]">from history</span>{/if}
					</td>
					{#if detail}<td class="font-num px-3 py-2.5 text-right text-[var(--text-muted)]">${(r.chargedMicros / 1_000_000).toFixed(5)}</td>{/if}
				</tr>
				{#if detail && open === r.id}
					<tr class="bg-[var(--bg-muted)]">
						<td colspan={cols} class="px-3 pb-3">
							<p class="flex flex-wrap gap-x-5 py-2 text-[12.5px] text-[var(--text-muted)]">
								<span>Paid geocoders: <b class="font-medium text-[var(--text-2)]">{r.providers.length ? r.providers.join(', ') : 'none'}</b></span>
								<span>Took <span class="font-num">{r.ms} ms</span></span>
							</p>
							<pre class="code">{JSON.stringify(r.response, null, 2)}</pre>
						</td>
					</tr>
				{/if}
			{:else}
				<tr><td colspan={cols} class="px-3 py-6 text-center text-[var(--text-muted)]">No lookups yet.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.pill {
		display: inline-block;
		border-radius: 999px;
		padding: 1px 8px;
		font-size: 11.5px;
		font-weight: 500;
		white-space: nowrap;
	}
	.pill.ok {
		background: color-mix(in srgb, var(--part-county) 14%, transparent);
		color: var(--part-county);
	}
	.pill.warn {
		background: var(--warn-soft);
		color: var(--warn);
	}
	.pill.err {
		background: color-mix(in srgb, var(--part-district) 14%, transparent);
		color: var(--part-district);
	}
	.code {
		margin: 0;
		max-height: 360px;
		overflow: auto;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		padding: 10px 12px;
		font-family: var(--font-mono);
		font-size: 12px;
		line-height: 1.6;
	}
</style>
