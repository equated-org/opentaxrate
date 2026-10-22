<script lang="ts">
	import { page } from '$app/state';
	import SiteFooter from '$lib/landing/SiteFooter.svelte';
	import SiteNav from '$lib/landing/SiteNav.svelte';

	let { children } = $props();

	type Link = { href: string; title: string; links?: Link[] };

	/** The reference is one page, an endpoint's sections indented under it;
	 *  each guide is its own page. */
	const GROUPS: Array<{ title: string; links: Link[] }> = [
		{
			title: 'API reference',
			links: [
				{ href: '/docs', title: 'Overview' },
				{
					href: '/docs#rate',
					title: 'GET /v1/rate',
					links: [
						{ href: '/docs#parameters', title: 'Parameters' },
						{ href: '/docs#response', title: 'Response' },
						{ href: '/docs#errors', title: 'Errors' }
					]
				},
				{ href: '/docs#coverage', title: 'GET /v1/coverage' }
			]
		},
		{
			title: 'Guides',
			links: [
				{ href: '/docs/codes', title: 'State codes and filing' },
				{ href: '/docs/regions', title: 'Regional data' },
				{ href: '/docs/releases', title: 'Data releases' }
			]
		}
	];

	const current = (href: string) => !href.includes('#') && page.url.pathname.replace(/\/$/, '') === href;
</script>

<div class="flex min-h-dvh flex-col">
	<SiteNav />

	<div class="mx-auto flex w-full max-w-[1100px] flex-1 gap-12 px-5 pt-10 pb-20 sm:px-8">
		<nav class="sticky top-[96px] hidden h-fit w-44 shrink-0 text-sm md:block" aria-label="Docs">
			{#each GROUPS as group (group.title)}
				<p class="mb-3 text-xs font-semibold tracking-wide text-[var(--text-muted)] uppercase not-first:mt-8">{group.title}</p>
				<ul class="flex flex-col gap-2">
					{#each group.links as link (link.href)}
						<li>
							<a
								class="hover:text-[var(--text)] {current(link.href) ? 'font-medium text-[var(--text)]' : 'text-[var(--text-2)]'}"
								href={link.href}>{link.title}</a
							>
							{#if link.links}
								<ul class="mt-2 flex flex-col gap-2 border-l border-[var(--border)] pl-3">
									{#each link.links as sub (sub.href)}
										<li><a class="text-[var(--text-muted)] hover:text-[var(--text)]" href={sub.href}>{sub.title}</a></li>
									{/each}
								</ul>
							{/if}
						</li>
					{/each}
				</ul>
			{/each}
		</nav>

		<main class="docs min-w-0 flex-1">
			{@render children()}
		</main>
	</div>

	<SiteFooter />
</div>

<style>
	.docs :global(.link) {
		white-space: normal;
	}
	.docs :global(.lead) {
		margin-top: 1rem;
		font-size: 1.15rem;
		color: var(--text-2);
		line-height: 1.7;
	}
	.docs :global(h1) {
		font-size: 34px;
		line-height: 1.25;
		font-weight: 600;
		letter-spacing: -0.025em;
		scroll-margin-top: 96px;
	}
	.docs :global(h2) {
		margin-top: 3rem;
		margin-bottom: 0.75rem;
		font-size: 1.35rem;
		font-weight: 600;
		scroll-margin-top: 96px;
	}
	.docs :global(h3) {
		margin-top: 2rem;
		font-size: 1.05rem;
		font-weight: 600;
		scroll-margin-top: 96px;
	}
	.docs :global(p) {
		margin-top: 0.75rem;
		color: var(--text-2);
		line-height: 1.75;
	}
	.docs :global(code) {
		font-family: 'Geist Mono Variable', ui-monospace, monospace;
		font-size: 0.85em;
		background: var(--bg-muted);
		border-radius: 4px;
		padding: 0.1em 0.35em;
	}
	.docs :global(pre) {
		margin-top: 0.75rem;
		overflow-x: auto;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg-muted);
		padding: 1rem 1.25rem;
		font-size: 13px;
		line-height: 1.6;
	}
	.docs :global(pre code) {
		background: none;
		padding: 0;
		font-size: inherit;
	}
	.docs :global(table) {
		margin-top: 1rem;
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
	}
	.docs :global(th) {
		text-align: left;
		font-weight: 600;
		border-bottom: 1px solid var(--border-strong);
		padding: 0.5rem 0.75rem 0.5rem 0;
	}
	.docs :global(td) {
		vertical-align: top;
		border-bottom: 1px solid var(--border);
		padding: 0.6rem 0.75rem 0.6rem 0;
		color: var(--text-2);
		line-height: 1.6;
	}
	.docs :global(td:first-child) {
		white-space: nowrap;
	}
</style>
