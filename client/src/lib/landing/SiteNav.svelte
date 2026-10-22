<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { ACCOUNTS, seemsSignedIn } from '$lib/accounts';
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

	// The page is prerendered signed out; swap the link once in the browser.
	let signedIn = $state(false);
	onMount(() => (signedIn = seemsSignedIn()));

	// The bar's line shows only once the page has scrolled under it.
	let scrolled = $state(false);
	const onscroll = () => (scrolled = window.scrollY > 0);
	onMount(onscroll);
</script>

<svelte:window {onscroll} />

<header
	class="sticky top-0 z-40 border-b bg-[var(--bg-translucent)] backdrop-blur transition-colors {scrolled
		? 'border-[var(--border)]'
		: 'border-transparent'}"
>
	<div class="flex h-16 items-center gap-3 px-4 pt-2 sm:h-[72px] sm:gap-5 sm:px-6 sm:pt-3">
		<a href="/" class="shrink-0 rounded" aria-label="OpenTaxRate home" onclick={onhome}>
			<span class={center ? 'hidden sm:inline' : ''}><Wordmark /></span>
			{#if center}<span class="sm:hidden"><Wordmark size="sm" /></span>{/if}
		</a>
		{#if center}
			<div class="mx-auto w-full max-w-[560px] min-w-0">{@render center()}</div>
		{/if}
		<nav class="ml-auto flex shrink-0 items-center gap-5 text-sm text-[var(--text-muted)]">
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : 'hidden sm:inline'}" href="/sources">Sources</a>
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : ''}" href="/benchmarks">Benchmarks</a>
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : ''}" href="/pricing">Pricing</a>
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : 'hidden sm:inline'}" href="/docs">Docs</a>
			<a class="hover:text-[var(--text)] {center ? 'hidden md:inline' : 'hidden sm:inline'}" href={GITHUB} target="_blank" rel="noopener"
				>GitHub</a
			>
			{#if ACCOUNTS}
				<a
					class="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[var(--text-2)] hover:text-[var(--text)] {center ? 'hidden md:inline' : ''}"
					href={signedIn ? '/dashboard' : '/login'}>{signedIn ? 'Dashboard' : 'Sign in'}</a
				>
			{/if}
		</nav>
	</div>
	{#if below}{@render below()}{/if}
</header>
