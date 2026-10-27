<script lang="ts" module>
	import type { LonLat, Outline } from '$lib/api';

	export interface Side {
		tag: string;
		point: LonLat;
		rate: number | null;
		outlines: Outline[];
	}
</script>

<script lang="ts">
	/**
	 * Two addresses and the tax outlines that tell them apart, drawn as a
	 * plain SVG from the engine's traces (no basemap, so it costs nothing on
	 * the landing page). Outlines that hold one address but not the other are
	 * filled; the ones both sit in are only traced. Each outline is clipped to
	 * the view before it becomes a path, so a county of 50,000 points draws as
	 * a few hundred.
	 */
	import { clipRing, ringsOf } from '$lib/map/clip';
	import { outlineName, PART_COLOR, pct } from './format';

	let { sides, height = 360 }: { sides: Side[]; height?: number } = $props();

	const uid = $props.id();
	const W = 800;
	const H = $derived(height);
	const DISTINCT = [PART_COLOR.city, PART_COLOR.district, 'var(--warn)', PART_COLOR.county];
	const COLOR: Record<string, string> = { place: PART_COLOR.city, cousub: PART_COLOR.city, district: PART_COLOR.district, county: PART_COLOR.county };

	const view = $derived.by(() => {
		const pts = sides.map((s) => s.point);
		const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
		const lon0 = pts.reduce((a, p) => a + p.lon, 0) / pts.length;
		const cos = Math.cos((lat0 * Math.PI) / 180);
		// Metres east and north of the centre.
		const m = (p: { lon: number; lat: number }) => [(p.lon - lon0) * cos * 111_320, (p.lat - lat0) * 110_540];
		const spanX = Math.max(...pts.map((p) => Math.abs(m(p)[0])));
		const spanY = Math.max(...pts.map((p) => Math.abs(m(p)[1])));
		// The pair fills about half the view, and never less than 300 m across.
		const scale = Math.min(W / Math.max(4 * spanX, 300), H / Math.max(4 * spanY, 300 * (H / W)));
		const project = (lon: number, lat: number): [number, number] => {
			const [x, y] = m({ lon, lat });
			return [W / 2 + x * scale, H / 2 - y * scale];
		};
		return { project, metresPerPx: 1 / scale };
	});

	const shapes = $derived.by(() => {
		const byKey = new Map<string, { outline: Outline; inside: string[] }>();
		for (const side of sides)
			for (const o of side.outlines) {
				if (!o.geometry) continue;
				const key = `${o.kind}:${o.fips}`;
				const entry = byKey.get(key) ?? { outline: o, inside: [] };
				if (o.inside && o.levies) entry.inside.push(side.tag);
				byKey.set(key, entry);
			}
		const pad = 40;
		return [...byKey.values()]
			.filter((e) => e.inside.length > 0)
			.map(({ outline, inside }) => {
				let d = '';
				for (const ring of ringsOf(outline.geometry)) {
					const projected = clipRing(
						ring.map(([lon, lat]) => view.project(lon, lat)),
						{ x0: -pad, y0: -pad, x1: W + pad, y1: H + pad }
					);
					let last = '';
					let part = '';
					for (const [x, y] of projected) {
						const p = `${x.toFixed(1)} ${y.toFixed(1)}`;
						if (p === last) continue;
						part += (part ? 'L' : 'M') + p;
						last = p;
					}
					if (part) d += part + 'Z';
				}
				return { outline, inside, d, differs: inside.length < sides.length, color: COLOR[outline.kind] ?? 'var(--text-muted)' };
			})
			.filter((s) => s.d)
			// Shared outlines underneath, the ones that differ on top, each of
			// those in its own colour so two cities can be told apart.
			.sort((a, b) => Number(a.differs) - Number(b.differs))
			.map((s, i, all) => {
				const nth = all.filter((x, j) => x.differs && j < i).length;
				return s.differs ? { ...s, color: DISTINCT[nth % DISTINCT.length] } : s;
			});
	});

	/** Each pin's label goes above it, else below, else beside, wherever it
	 *  doesn't cover a label already placed. */
	const LABEL = { w: 88, h: 26, gap: 16 };
	const pins = $derived.by(() => {
		const placed: { x: number; y: number }[] = [];
		const clear = (x: number, y: number) => placed.every((b) => Math.abs(b.x - x) > LABEL.w + 4 || Math.abs(b.y - y) > LABEL.h + 4);
		return sides.map((s) => {
			const at = view.project(s.point.lon, s.point.lat);
			const spots: [number, number][] = [
				[0, -LABEL.gap - LABEL.h],
				[0, LABEL.gap],
				[LABEL.w / 2 + 14, -LABEL.h / 2],
				[-LABEL.w / 2 - 14, -LABEL.h / 2]
			];
			const [dx, dy] = spots.find(([dx, dy]) => clear(at[0] + dx, at[1] + dy)) ?? spots[0];
			placed.push({ x: at[0] + dx, y: at[1] + dy });
			return { ...s, at, label: [dx, dy] as [number, number] };
		});
	});
	const scaleBar = $derived.by(() => {
		const target = view.metresPerPx * 120;
		const nice = [50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((n) => n >= target) ?? 10000;
		return { px: nice / view.metresPerPx, label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` };
	});
	const legend = $derived(shapes.filter((s) => s.differs));
</script>

<figure class="flex flex-col gap-3">
	<svg viewBox="0 0 {W} {H}" class="sketch block h-auto w-full" role="img" aria-label="Map sketch: {pins.map((p) => `${p.tag} ${p.rate === null ? 'declined' : pct(p.rate)}`).join(', ')}">
		<defs>
			<clipPath id="{uid}-view"><rect width={W} height={H} rx="14" /></clipPath>
		</defs>
		<g clip-path="url(#{uid}-view)">
			<rect width={W} height={H} fill="var(--bg-muted)" />
			{#each shapes as s (s.outline.kind + s.outline.fips)}
				<path
					d={s.d}
					fill-rule="evenodd"
					fill={s.differs ? `color-mix(in srgb, ${s.color} 16%, transparent)` : 'none'}
					stroke={s.color}
					stroke-width={s.differs ? 2.5 : 1}
					stroke-dasharray={s.differs ? undefined : '5 5'}
					stroke-opacity={s.differs ? 1 : 0.55}
					stroke-linejoin="round"
				/>
			{/each}
			{#each pins as p (p.tag)}
				<g transform="translate({p.at[0]} {p.at[1]})">
					<line
						x2={p.label[0] === 0 ? 0 : p.label[0] - Math.sign(p.label[0]) * (LABEL.w / 2)}
						y2={p.label[1] < 0 ? p.label[1] + LABEL.h : p.label[1] > LABEL.h / 2 ? p.label[1] : 0}
						stroke="var(--text)"
						stroke-width="1.5"
					/>
					<circle r="7" fill="var(--accent)" stroke="var(--bg)" stroke-width="3" />
					<g transform="translate({p.label[0]} {p.label[1]})">
						<rect x={-LABEL.w / 2} width={LABEL.w} height={LABEL.h} rx="13" fill="var(--text)" />
						<text y="17.5" text-anchor="middle" fill="var(--bg)" class="font-num">{p.tag} · {p.rate === null ? '—' : pct(p.rate, true)}</text>
					</g>
				</g>
			{/each}
			<g transform="translate(20 {H - 22})">
				<line x2={scaleBar.px} stroke="var(--text-muted)" stroke-width="2" />
				<text x={scaleBar.px + 8} y="4" fill="var(--text-muted)" class="small">{scaleBar.label}</text>
			</g>
		</g>
	</svg>
	{#if legend.length}
		<figcaption class="flex flex-col gap-1 text-[13px] leading-snug text-[var(--text-muted)]">
			{#each legend as s (s.outline.kind + s.outline.fips)}
				<span class="flex items-center gap-2">
					<span class="inline-block h-2.5 w-2.5 shrink-0" style="background: {s.color}"></span>
					<span><span class="text-[var(--text)]">{outlineName(s.outline)}</span>: {s.inside.join(' and ')} inside, {sides
							.map((x) => x.tag)
							.filter((t) => !s.inside.includes(t))
							.join(' and ')} outside</span>
				</span>
			{/each}
		</figcaption>
	{/if}
</figure>

<style>
	.sketch text {
		font-size: 14px;
		font-weight: 600;
	}
	.sketch text.small {
		font-size: 12px;
		font-weight: 400;
	}
</style>
