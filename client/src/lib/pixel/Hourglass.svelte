<script lang="ts">
	import Pixels from './Pixels.svelte';
	import { HOURGLASS } from './art';
</script>

<span class="hourglass inline-block">
	<Pixels rows={HOURGLASS} cell={4} palette={{ '#': 'var(--text)', s: 'var(--warn)' }} />
</span>

<style>
	.hourglass {
		animation: flip 2.4s steps(1) infinite;
	}
	@keyframes flip {
		0%,
		45% {
			transform: rotate(0deg);
		}
		50%,
		95% {
			transform: rotate(180deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hourglass {
			animation: none;
		}
	}
</style>
