<script lang="ts">
	/** The rate as a row of pixel cells, coloured by the part each cell
	 *  belongs to. `max` is the rate the full bar stands for. */
	interface Segment {
		rate: number;
		color: string;
		label: string;
	}
	let { segments, max = 0.1, cells = 40 }: { segments: Segment[]; max?: number; cells?: number } =
		$props();

	const filled = $derived.by(() => {
		const total = segments.reduce((s, x) => s + x.rate, 0);
		const scale = Math.max(max, total);
		// Largest-remainder rounding so the cells add up to the total's share.
		const want = (total / scale) * cells;
		const raw = segments.map((s) => (s.rate / scale) * cells);
		const counts = raw.map((r) => Math.floor(r));
		let left = Math.round(want) - counts.reduce((a, b) => a + b, 0);
		const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
		for (const [frac, i] of order) {
			if (left <= 0) break;
			if (frac > 0) {
				counts[i]++;
				left--;
			}
		}
		// A part that's non-zero always gets at least one cell.
		segments.forEach((s, i) => {
			if (s.rate > 0 && counts[i] === 0) counts[i] = 1;
		});
		const out: string[] = [];
		segments.forEach((s, i) => {
			for (let k = 0; k < counts[i]; k++) out.push(s.color);
		});
		return out.slice(0, cells);
	});
</script>

<svg
	class="pixelated block w-full"
	viewBox="0 0 {cells * 5 - 1} 6"
	preserveAspectRatio="none"
	role="img"
	aria-label={segments.map((s) => s.label).join(', ')}
	height="14"
>
	{#each Array(cells) as _, i (i)}
		<rect x={i * 5} y="0" width="4" height="6" fill={filled[i] ?? 'var(--border)'} />
	{/each}
</svg>
