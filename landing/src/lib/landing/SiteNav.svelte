<script lang="ts">
	import type { Snippet } from 'svelte';
	import { GITHUB } from '$lib/examples';
	import Wordmark from '$lib/pixel/Wordmark.svelte';

	/** The bar at the top of every page: the wordmark, then whatever the page
	 *  puts in the middle (the result page's search box), then the links. */
	let {
		onhome,
		center,
		below
	}: {
		onhome?: (event: MouseEvent) => void;
		center?: Snippet;
		/** Under the bar's border, e.g. the progress strip. */
		below?: Snippet;
	} = $props();
</script>

<header class="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg-translucent)] backdrop-blur">
	<div class="flex h-14 items-center gap-3 px-4 sm:gap-5 sm:px-6">
		<a href="/" class="shrink-0 rounded" aria-label="OpenTaxRate home" onclick={onhome}>
			<span class={center ? 'hidden sm:inline' : ''}><Wordmark /></span>
			{#if center}<span class="sm:hidden"><Wordmark size="sm" /></span>{/if}
		</a>
		{#if center}
			<div class="mx-auto w-full max-w-[560px] min-w-0">{@render center()}</div>
		{/if}
		<nav class="ml-auto flex shrink-0 items-center gap-5 text-sm text-[var(--text-muted)]">
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : ''}" href="/sources">Sources</a>
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : ''}" href="/benchmarks">Benchmarks</a>
			<a
				class="hidden hover:text-[var(--text)] {center ? 'lg:inline' : 'sm:inline'}"
				href="{GITHUB}/blob/main/docs/context/api.md"
				target="_blank"
				rel="noopener">API</a
			>
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : ''}" href={GITHUB} target="_blank" rel="noopener"
				>GitHub</a
			>
		</nav>
	</div>
	{#if below}{@render below()}{/if}
</header>
