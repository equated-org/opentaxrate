<script lang="ts">
	import Pixels from './Pixels.svelte';
	import { MARK } from './art';

	let { size = 'sm' }: { size?: 'sm' | 'lg' } = $props();
</script>

<span class="inline-flex items-center gap-2 text-[var(--text)]">
	<Pixels rows={MARK} cell={size === 'lg' ? 3 : 2} />
	<span class="font-pixel {size === 'lg' ? 'text-[22px]' : 'text-[15px]'} leading-none tracking-tight"
		>opentaxrate</span
	>
</span>
