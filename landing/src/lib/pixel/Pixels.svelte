<script lang="ts">
	/**
	 * Pixel art from rows of characters: each character is one cell, `.` or a
	 * space is empty, and `palette` maps the others to a colour. Horizontal
	 * runs of one colour become one <rect>, drawn with crisp edges.
	 */
	interface Props {
		rows: string[];
		palette?: Record<string, string>;
		/** CSS size of one cell, in px. */
		cell?: number;
		class?: string;
		title?: string;
	}

	let { rows, palette = { '#': 'currentColor' }, cell = 2, class: klass = '', title }: Props = $props();

	const width = $derived(Math.max(...rows.map((r) => r.length)));
	const runs = $derived.by(() => {
		const out: { x: number; y: number; w: number; fill: string }[] = [];
		rows.forEach((row, y) => {
			let x = 0;
			while (x < row.length) {
				const ch = row[x];
				if (ch === '.' || ch === ' ' || !palette[ch]) {
					x++;
					continue;
				}
				let end = x + 1;
				while (end < row.length && row[end] === ch) end++;
				out.push({ x, y, w: end - x, fill: palette[ch] });
				x = end;
			}
		});
		return out;
	});
</script>

<svg
	class="pixelated {klass}"
	width={width * cell}
	height={rows.length * cell}
	viewBox="0 0 {width} {rows.length}"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title}
>
	{#each runs as r, i (i)}
		<rect x={r.x} y={r.y} width={r.w} height="1" fill={r.fill} />
	{/each}
</svg>
