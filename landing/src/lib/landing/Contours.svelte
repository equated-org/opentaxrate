<script lang="ts">
	/** Faint topographic contour lines, like a survey map, for the showcase
	 *  panel's ground. Generated once: nested wobbly rings around two hills. */
	const W = 1200;
	const H = 700;

	function ring(cx: number, cy: number, r: number, seed: number): string {
		const steps = 72;
		const pts: string[] = [];
		for (let i = 0; i < steps; i++) {
			const a = (i / steps) * Math.PI * 2;
			const wobble = 1 + 0.11 * Math.sin(3 * a + seed) + 0.06 * Math.sin(5 * a - seed * 1.7) + 0.04 * Math.cos(2 * a + seed * 0.5);
			const x = cx + Math.cos(a) * r * 1.35 * wobble;
			const y = cy + Math.sin(a) * r * wobble;
			pts.push(`${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`);
		}
		return pts.join('') + 'Z';
	}

	const PATHS = [
		...Array.from({ length: 9 }, (_, k) => ring(260, 520, 40 + k * 46, 1.3 + k * 0.35)),
		...Array.from({ length: 8 }, (_, k) => ring(980, 150, 30 + k * 48, 4.1 + k * 0.3))
	];
</script>

<svg class="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
	{#each PATHS as d, i (i)}
		<path {d} fill="none" stroke="currentColor" stroke-width="1.2" vector-effect="non-scaling-stroke" />
	{/each}
</svg>
