<script lang="ts">
	import { GITHUB } from '$lib/examples';
</script>

<footer class="mt-20 border-t border-[var(--border)] px-5 py-8 text-[13px] text-[var(--text-muted)]">
	<nav class="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
		<a class="hover:text-[var(--text)]" href="/sources">Sources</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href="/benchmarks">Benchmarks</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href="/pricing">Pricing</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href="{GITHUB}#quick-start" target="_blank" rel="noopener">Run it yourself</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href="{GITHUB}/blob/main/docs/context/api.md" target="_blank" rel="noopener">API</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href="{GITHUB}#coverage" target="_blank" rel="noopener">Coverage</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href={GITHUB} target="_blank" rel="noopener">GitHub</a>
		<span aria-hidden="true">·</span>
		<a class="hover:text-[var(--text)]" href="{GITHUB}/blob/main/LICENSE" target="_blank" rel="noopener">Elastic License 2.0</a>
	</nav>
	<p class="mt-3 text-center">
		opentaxrate by
		<a class="font-medium text-[var(--text)] underline-offset-4 hover:underline" href="https://equated.co" target="_blank" rel="noopener"
			>Equated</a
		>
	</p>
</footer>
