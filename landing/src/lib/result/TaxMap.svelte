<script lang="ts">
	/**
	 * The map: OpenFreeMap tiles, muted, with the engine's trace drawn on top
	 * (layers.ts). Loaded only after the first result, so MapLibre stays out
	 * of the empty page's JavaScript.
	 */
	// Linked at runtime, not imported: SvelteKit puts a lazy component's
	// imported CSS on the page up front, and MapLibre's is 10 KB gzip.
	import maplibreCss from 'maplibre-gl/dist/maplibre-gl.css?url';
	import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl';
	// MapLibre finds its worker next to its own module, which a bundler moves;
	// point it at the copy Vite emits.
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
	import { mount, unmount } from 'svelte';
	import type { LonLat, Match, RatePart, Trace } from '$lib/api';
	import { clearTrace, drawTrace, MAP_COLORS } from '$lib/map/layers';
	import { blankStyle, labelFont, mutedStyle, type MapTheme } from '$lib/map/style';
	import Inset from '$lib/map/Inset.svelte';
	import PixelPin from '$lib/pixel/PixelPin.svelte';
	import { outlineFor, outlineName, pct } from './format';

	interface Props {
		trace: Trace | null;
		parts: RatePart[];
		refused: boolean;
		match: Match | null;
		stateName: string;
		/** Where the search box put the address, when it had a point. */
		fallback: (LonLat & { from?: 'street' }) | null;
		theme: MapTheme;
	}

	let { trace, parts, refused, match, stateName, fallback, theme }: Props = $props();

	setWorkerUrl(workerUrl);

	function linkCss(): Promise<void> {
		if (document.querySelector(`link[href="${maplibreCss}"]`)) return Promise.resolve();
		return new Promise((done) => {
			const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: maplibreCss });
			link.onload = link.onerror = () => done();
			document.head.appendChild(link);
		});
	}

	let container: HTMLDivElement | undefined = $state();
	let map: MapLibreMap | undefined;
	let ready = $state(false);
	let styledTheme: MapTheme | undefined;
	let font = ['Noto Sans Regular'];
	let markers: { marker: Marker; component: ReturnType<typeof mount> }[] = [];
	let tilesFailed = $state(false);
	let first = true;

	async function styleFor(t: MapTheme) {
		try {
			const s = await mutedStyle(t);
			tilesFailed = false;
			return s;
		} catch (error) {
			console.warn('basemap unavailable', error);
			tilesFailed = true;
			return blankStyle(t);
		}
	}

	$effect(() => {
		if (!container) return;
		let cancelled = false;
		const t = theme;
		Promise.all([styleFor(t), linkCss()]).then(([style]) => {
			if (cancelled || !container) return;
			font = labelFont(style);
			styledTheme = t;
			map = new MapLibreMap({
				container,
				style,
				center: [-98.5, 39.5],
				zoom: 3,
				attributionControl: { compact: false },
				dragRotate: false,
				pitchWithRotate: false,
				touchPitch: false,
				maxPitch: 0
			});
			map.touchZoomRotate.disableRotation();
			map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
			map.on('load', () => (ready = true));
		});
		return () => {
			cancelled = true;
			clearMarkers();
			map?.remove();
			map = undefined;
			ready = false;
		};
	});

	// Theme changes restyle the same map, then redraw the trace on it.
	$effect(() => {
		const t = theme;
		if (!ready || !map || t === styledTheme) return;
		styledTheme = t;
		const m = map;
		styleFor(t).then((style) => {
			if (map !== m) return;
			font = labelFont(style);
			m.once('style.load', () => render(false));
			m.setStyle(style, { diff: false });
		});
	});

	$effect(() => {
		// Track every input, then draw.
		void [trace, parts, refused, fallback, match];
		if (ready) render(!first);
	});

	function clearMarkers() {
		for (const m of markers) {
			m.marker.remove();
			unmount(m.component);
		}
		markers = [];
	}

	function addPin(at: LonLat, label?: string) {
		if (!map) return;
		const el = document.createElement('div');
		el.className = 'otr-pin';
		const component = mount(PixelPin, { target: el, props: { cell: 3 } });
		if (label) {
			const tag = document.createElement('span');
			tag.className = 'otr-pin-label';
			tag.textContent = label;
			el.appendChild(tag);
		}
		const marker = new Marker({ element: el, anchor: 'bottom' }).setLngLat([at.lon, at.lat]).addTo(map);
		markers.push({ marker, component });
	}

	function outlineBounds(t: Trace): LngLatBounds | null {
		const b = new LngLatBounds();
		let any = false;
		const walk = (c: unknown): void => {
			if (Array.isArray(c) && typeof c[0] === 'number') {
				b.extend([c[0] as number, c[1] as number]);
				any = true;
			} else if (Array.isArray(c)) c.forEach(walk);
		};
		for (const o of t.outlines) walk((o.geometry as { coordinates?: unknown } | undefined)?.coordinates);
		return any ? b : null;
	}

	function render(animate: boolean) {
		if (!map) return;
		first = false;
		clearMarkers();
		const duration = animate ? 700 : 0;
		const wide = (container?.clientWidth ?? 0) >= 720;
		const padding = { top: 64, bottom: 64, left: 64, right: wide && showInset ? 250 : 64 };
		let fit: LonLat[] = [];
		if (trace && (trace.outlines.length || trace.geocoders.length || trace.point))
			fit = drawTrace(map, { trace, parts, refused }, theme, font);
		else clearTrace(map);

		if (trace?.point) {
			addPin(trace.point);
			const b = new LngLatBounds();
			for (const p of fit) b.extend([p.lon, p.lat]);
			map.fitBounds(b, { padding, maxZoom: 17, duration });
		} else if (fallback) {
			addPin(fallback, 'where the search box put it');
			map.easeTo({ center: [fallback.lon, fallback.lat], zoom: match === 'statewide' ? 6 : 15.5, duration });
		} else if (trace) {
			const b = outlineBounds(trace);
			if (b) map.fitBounds(b, { padding, maxZoom: 15, duration });
		}
	}

	const note = $derived.by(() => {
		if (trace?.point) return null;
		const where = fallback?.from === 'street' ? ' (on the street; OpenStreetMap lacks the house)' : '';
		if (!fallback) return 'The outlines the engine tested. It sent no point to show.';
		switch (match) {
			case 'street':
			case 'zip4':
			case 'zip5':
				return `The street range decided the rate, not the map. The pin is where the search box put the address${where}, only to center the map.`;
			case 'statewide':
				return `One rate across ${stateName}. The pin is where the search box put the address${where}.`;
			case 'authority':
				return `${stateName}'s tax office decided the rate. The pin is where the search box put the address${where}.`;
			default:
				return `This API sent no trace, so the map shows only where the search box put the address${where}.`;
		}
	});

	const legend = $derived(
		(trace?.outlines ?? [])
			.filter((o) => o.geometry)
			.map((o) => {
				const part = o.inside && o.levies ? parts.find((p) => outlineFor(p, [o]) === o) : undefined;
				const group = o.kind === 'county' ? 'county' : o.kind === 'district' ? 'district' : 'place';
				const close = refused && !!trace?.point && o.edgeMetres <= trace.point.marginMetres;
				return {
					name: outlineName(o),
					group,
					close,
					text: o.inside ? (o.levies ? (part ? `levies ${pct(part.rate, true)}` : 'levies') : 'levies none') : 'outside'
				};
			})
	);
	const colors = $derived(MAP_COLORS[theme]);
	/** The inset only adds something when the map is zoomed out past the
	 *  margin, i.e. the nearest edge is well beyond it. */
	const showInset = $derived.by(() => {
		const p = trace?.point;
		if (!p) return false;
		const nearest = Math.min(...(trace?.outlines.map((o) => o.edgeMetres) ?? [Infinity]));
		return nearest > p.marginMetres * 4;
	});
</script>

<div class="relative h-full min-h-[360px] w-full overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-muted)]">
	<!-- MapLibre makes its container position: relative, so it sits in an absolute frame. -->
	<div class="absolute inset-0">
		<div bind:this={container} class="h-full w-full" role="region" aria-label="Map of where the address fell"></div>
	</div>

	{#if note}
		<p class="overlay top-3 left-3 max-w-[22rem] text-[13px] leading-snug">{note}</p>
	{/if}
	{#if tilesFailed}
		<p class="overlay top-3 left-3 text-[13px]">The basemap couldn't load; the outlines are drawn without it.</p>
	{/if}

	{#if legend.length}
		<ul class="overlay bottom-3 left-3 hidden max-w-[19rem] flex-col gap-1 text-[12px] sm:flex" aria-label="Outlines">
			{#each legend as l, i (i)}
				<li class="flex items-center gap-2 {l.text === 'outside' ? 'text-[var(--text-muted)]' : ''}">
					<svg width="22" height="8" aria-hidden="true" class="shrink-0">
						<line
							x1="1"
							y1="4"
							x2="21"
							y2="4"
							stroke={l.close ? colors.accent : l.group === 'place' ? colors.city : l.group === 'district' ? colors.district : colors.county}
							stroke-width={l.close ? 2.6 : 1.8}
							stroke-dasharray={l.group === 'district' ? '4 3' : l.group === 'county' ? '1 3' : undefined}
							stroke-linecap={l.group === 'county' ? 'round' : undefined}
						/>
					</svg>
					<span class="truncate"><span class="text-[var(--text)]">{l.name}</span> · {l.text}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if showInset && trace?.point}
		<div class="absolute right-3 bottom-9 z-10 hidden md:block">
			<Inset trace={trace as Trace & { point: NonNullable<Trace['point']> }} {refused} />
		</div>
	{/if}
</div>

<style>
	.overlay {
		position: absolute;
		z-index: 10;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--bg-translucent);
		backdrop-filter: blur(4px);
		color: var(--text-2);
	}
	:global(.otr-pin) {
		display: flex;
		flex-direction: column-reverse;
		align-items: center;
		filter: drop-shadow(0 1px 0 rgba(0, 0, 0, 0.15));
	}
	:global(.otr-pin-label) {
		margin-bottom: 4px;
		padding: 2px 7px;
		border-radius: 6px;
		background: var(--text);
		color: var(--bg);
		font-size: 11.5px;
		white-space: nowrap;
	}
	:global(.dark .otr-pin) {
		--pin-ink: #f5f5f5;
	}
</style>
