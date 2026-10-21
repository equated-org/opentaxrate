<script lang="ts">
	import Pixels from '$lib/pixel/Pixels.svelte';
	import { SIGN } from '$lib/pixel/art';
	import type { Trace } from '$lib/api';
	import Actions from './Actions.svelte';
	import { distance, nearestEdge } from './format';

	let { message, code, trace, url, raw }: { message: string; code: string; trace: Trace | null; url: string; raw: unknown } =
		$props();

	/** The rates a refusal names, e.g. "8.25% or 6.75%". */
	const candidates = $derived([...new Set(message.match(/\d+(?:\.\d+)?%/g) ?? [])]);
	const near = $derived(nearestEdge(trace));
	const unsupported = $derived(code === 'UNSUPPORTED_STATE');
</script>

<section aria-labelledby="refusal-heading" class="flex flex-col gap-6">
	<div class="flex items-start gap-3">
		<Pixels rows={SIGN} cell={3} palette={{ '#': 'var(--warn)', w: 'var(--bg)' }} class="mt-1 shrink-0" />
		<div>
			<h2 id="refusal-heading" class="text-sm text-[var(--text-muted)]">
				{unsupported ? 'Not covered yet' : 'No single rate: confirm this address'}
			</h2>
			<p class="mt-1 text-[17px] leading-snug text-[var(--text)]">{message}</p>
		</div>
	</div>

	{#if candidates.length > 1}
		<div>
			<h3 class="text-sm font-semibold">It could be</h3>
			<div class="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-2">
				{#each candidates as c, i (c)}
					{#if i > 0}<span class="text-sm text-[var(--text-muted)]">or</span>{/if}
					<span class="font-num rounded-lg border border-[var(--border)] px-3 py-1.5 text-[22px] font-semibold tracking-[-0.03em]">{c}</span>
				{/each}
			</div>
		</div>
	{/if}

	<div>
		<h3 class="text-sm font-semibold">Why it refused</h3>
		<p class="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
			{#if near && trace?.point && near.edgeMetres <= trace.point.marginMetres}
				The {near.name} line is {distance(near.edgeMetres)} from the point, inside the {distance(trace.point.marginMetres)}
				margin the geocoders' accuracy allows. The map draws it in blue. OpenTaxRate returns a refusal rather than guess which
				side the address is on.
			{:else if unsupported}
				OpenTaxRate only answers where it has the state's own data loaded.
			{:else}
				OpenTaxRate returns a refusal rather than a guess when the data can't put the address in one rate.
			{/if}
		</p>
	</div>

	<p class="font-mono text-[11px] text-[var(--text-muted)]">{code}</p>

	<Actions {url} {raw} />
</section>
