<script lang="ts">
	/**
	 * The points and the margin at street scale, drawn as plain SVG: at the
	 * main map's zoom a 40 m circle and two points 15 m apart are a dot.
	 */
	import type { Geometry } from 'geojson';
	import type { Trace } from '$lib/api';
	import { distance, GEOCODER_NAME } from '$lib/result/format';
	import { edgeLines } from './layers';

	let { trace, refused }: { trace: Trace & { point: NonNullable<Trace['point']> }; refused: boolean } = $props();

	const SIZE = 168;
	const p = $derived(trace.point);
	const kx = $derived(111_320 * Math.cos((p.lat * Math.PI) / 180));
	const KY = 110_540;
	/** Metres from the centre to the box's edge. */
	const reach = $derived(Math.max(p.marginMetres * 1.9, p.spreadMetres * 1.6, 50));
	const scale = $derived(SIZE / 2 / reach);
	const xy = (lon: number, lat: number): [number, number] => [
		SIZE / 2 + (lon - p.lon) * kx * scale,
		SIZE / 2 - (lat - p.lat) * KY * scale
	];

	const edges = $derived(
		trace.outlines
			.filter((o) => o.geometry && o.edgeMetres < reach * 1.5)
			.map((o) => {
				const d = edgeLines(o.geometry as Geometry)
					.coordinates.map((line) => line.map(([lon, lat], i) => `${i ? 'L' : 'M'}${xy(lon, lat).map((n) => n.toFixed(1)).join(' ')}`).join(''))
					.join('');
				return { d, kind: o.kind, close: refused && o.edgeMetres <= p.marginMetres };
			})
	);
	const points = $derived(
		trace.geocoders
			.filter((g) => g.source !== 'mapbox')
			.map((g) => ({ at: xy(g.lon, g.lat), name: GEOCODER_NAME[g.source] ?? g.source, used: g.source === p.source }))
	);
	const color = (kind: string, close: boolean) =>
		close ? 'var(--accent)' : kind === 'district' ? 'var(--part-district)' : kind === 'county' ? 'var(--text-muted)' : 'var(--part-city)';
	const across = $derived(Math.round((reach * 2) / 10) * 10);
</script>

<figure class="inset" aria-label="Inset: the geocoders' points and the {distance(p.marginMetres)} margin at street scale">
	<figcaption class="font-num">INSET · {across} M ACROSS</figcaption>
	<svg width={SIZE} height={SIZE} viewBox="0 0 {SIZE} {SIZE}" aria-hidden="true">
		<defs>
			<clipPath id="inset-clip"><rect width={SIZE} height={SIZE} /></clipPath>
		</defs>
		<g clip-path="url(#inset-clip)">
			{#each edges as e, i (i)}
				<path
					d={e.d}
					fill="none"
					stroke={color(e.kind, e.close)}
					stroke-width={e.close ? 2.2 : 1.3}
					stroke-dasharray={e.kind === 'district' ? '5 3' : e.kind === 'county' ? '1 3' : undefined}
				/>
			{/each}
			<circle
				cx={SIZE / 2}
				cy={SIZE / 2}
				r={p.marginMetres * scale}
				fill="color-mix(in srgb, var(--accent) 8%, transparent)"
				stroke="var(--accent)"
				stroke-width="1.4"
				stroke-dasharray="4 3"
			/>
			{#each points as pt (pt.name)}
				<rect
					x={pt.at[0] - 3.5}
					y={pt.at[1] - 3.5}
					width="7"
					height="7"
					fill={pt.used ? 'var(--accent)' : 'var(--bg)'}
					stroke={pt.used ? 'var(--accent)' : 'var(--text)'}
					stroke-width="1.4"
					shape-rendering="crispEdges"
				/>
			{/each}
		</g>
	</svg>
	<ul>
		{#each points as pt (pt.name)}
			<li><span class="sw {pt.used ? 'used' : ''}"></span>{pt.name}{pt.used ? ' (used)' : ''}</li>
		{/each}
		<li><span class="sw ring"></span>{distance(p.marginMetres)} margin · {distance(p.spreadMetres)} apart</li>
	</ul>
</figure>

<style>
	.inset {
		margin: 0;
		padding: 8px 10px 10px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--bg-translucent);
		backdrop-filter: blur(4px);
		box-shadow: var(--shadow);
		color: var(--text-2);
	}
	figcaption {
		font-size: 11px;
		letter-spacing: 0.04em;
		color: var(--text-muted);
		margin-bottom: 6px;
	}
	svg {
		display: block;
		border-radius: 6px;
		background: color-mix(in srgb, var(--bg-muted) 70%, transparent);
	}
	ul {
		margin-top: 6px;
		font-size: 11px;
		line-height: 1.5;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.sw {
		width: 7px;
		height: 7px;
		border: 1.4px solid var(--text);
		background: var(--bg);
	}
	.sw.used {
		border-color: var(--accent);
		background: var(--accent);
	}
	.sw.ring {
		border: 1.4px dashed var(--accent);
		border-radius: 50%;
		width: 9px;
		height: 9px;
	}
</style>
