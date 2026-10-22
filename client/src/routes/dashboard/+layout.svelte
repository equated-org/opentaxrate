<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { rememberSignedIn } from '$lib/accounts';
	import { authClient } from '$lib/auth';
	import { dashboard } from '$lib/dashboard.svelte';
	import Wordmark from '$lib/pixel/Wordmark.svelte';

	let { children } = $props();

	const TABS = [
		{ href: '/dashboard', label: 'Home' },
		{ href: '/dashboard/keys', label: 'API keys' },
		{ href: '/dashboard/history', label: 'History' }
	];
	const here = (href: string) => page.url.pathname.replace(/\/$/, '') === href;

	onMount(async () => {
		await dashboard.refresh();
		if (dashboard.signedOut) await goto('/login');
	});

	async function signOut() {
		await authClient.signOut();
		rememberSignedIn(false);
		await goto('/login');
	}
</script>

<svelte:head>
	<title>Dashboard · OpenTaxRate</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="flex min-h-dvh flex-col">
	<header class="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--bg-translucent)] backdrop-blur">
		<div class="flex h-14 items-center px-4 sm:px-6">
			<a href="/dashboard" class="rounded" aria-label="Dashboard home"><Wordmark /></a>
		</div>
	</header>

	{#if dashboard.summary}
		<div class="mx-auto grid w-full max-w-[1120px] flex-1 gap-5 px-5 pt-6 pb-20 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12 md:px-6 md:pt-10">
			<nav class="flex flex-wrap gap-0.5 self-start md:sticky md:top-24 md:flex-col" aria-label="Dashboard">
				{#each TABS as tab (tab.href)}
					<a
						href={tab.href}
						aria-current={here(tab.href) ? 'page' : undefined}
						class="rounded-lg px-2.5 py-1.5 text-[14px] text-[var(--text-muted)] hover:bg-[var(--bg-muted)] hover:text-[var(--text)] aria-[current=page]:bg-[var(--bg-muted)] aria-[current=page]:font-medium aria-[current=page]:text-[var(--text)]"
						>{tab.label}</a
					>
				{/each}
				<button class="ml-auto px-2.5 py-1.5 text-[13px] text-[var(--text-muted)] underline underline-offset-3 md:hidden" onclick={signOut}>Sign out</button>
				<div class="mt-5 hidden gap-1.5 border-t border-[var(--border)] px-2.5 pt-3 text-[12.5px] text-[var(--text-muted)] md:grid">
					<b class="font-medium break-all text-[var(--text-2)]">{dashboard.summary.email}</b>
					<span><span class="font-num">{dashboard.summary.lookupsLeft.toLocaleString()}</span> lookups left</span>
					<button class="justify-self-start underline underline-offset-3 hover:text-[var(--text)]" onclick={signOut}>Sign out</button>
				</div>
			</nav>
			<main class="min-w-0">{@render children()}</main>
		</div>
	{/if}
</div>
