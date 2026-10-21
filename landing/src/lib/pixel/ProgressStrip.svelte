<script lang="ts">
	/** An indeterminate progress strip: a block of lit cells sweeps along a
	 *  row of square pixels. */
	let { cells = 32, label = 'Looking up the rate' }: { cells?: number; label?: string } = $props();
</script>

<div class="strip" role="progressbar" aria-label={label} aria-busy="true" style="--n: {cells}">
	{#each Array(cells) as _, i (i)}
		<span style="animation-delay: {(i * 1.4) / cells}s"></span>
	{/each}
</div>

<style>
	.strip {
		display: grid;
		grid-template-columns: repeat(var(--n), 1fr);
		gap: 2px;
		height: 6px;
		width: 100%;
	}
	span {
		background: var(--border);
		animation: lit 1.4s steps(1) infinite;
	}
	@keyframes lit {
		0% {
			background: var(--accent);
		}
		18% {
			background: color-mix(in srgb, var(--accent) 45%, var(--border));
		}
		30% {
			background: var(--border);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		span {
			animation-duration: 4s;
		}
	}
</style>
