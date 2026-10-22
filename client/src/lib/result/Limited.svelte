<script lang="ts">
	import Hourglass from '$lib/pixel/Hourglass.svelte';
	import { onDestroy } from 'svelte';

	let { message, retryAfter, onretry }: { message: string; retryAfter: number | null; onretry: () => void } = $props();

	const SELF_HOST = 'https://github.com/equated-org/opentaxrate#quick-start';
	const startedAt = Date.now();
	let now = $state(Date.now());
	const timer = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(timer));

	const left = $derived(retryAfter === null ? null : Math.max(0, retryAfter - Math.floor((now - startedAt) / 1000)));
</script>

<section aria-labelledby="limited-heading" class="flex flex-col items-start gap-5">
	<Hourglass />
	<div>
		<h2 id="limited-heading" class="text-[17px] font-semibold">
			{#if left === null}
				Too many lookups for now
			{:else if left > 0}
				Try again in <span class="font-num">{left}</span> s
			{:else}
				Ready to try again
			{/if}
		</h2>
		<p class="mt-1 text-sm leading-relaxed text-[var(--text-2)]">
			{message} The public demo limits each visitor so it stays free. For more, run your own: it's one
			<code class="rounded bg-[var(--bg-muted)] px-1 font-mono text-[12px]">docker compose up</code>, with no limit.
		</p>
	</div>
	<div class="flex flex-wrap gap-2">
		<button type="button" class="btn" disabled={left !== null && left > 0} onclick={onretry}>Try again</button>
		<a class="btn" href={SELF_HOST} target="_blank" rel="noopener">Run it yourself</a>
	</div>
</section>
