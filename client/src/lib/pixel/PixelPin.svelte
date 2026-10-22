<script lang="ts">
	import Pixels from './Pixels.svelte';
	import { PIN } from './art';

	let { cell = 3, color = 'var(--accent)' }: { cell?: number; color?: string } = $props();
</script>

<Pixels rows={PIN} {cell} palette={{ '#': 'var(--pin-ink, #0a0a0a)', o: color, w: '#ffffff' }} />
