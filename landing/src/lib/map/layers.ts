/**
 * The engine's trace as MapLibre sources and layers: the outlines it tested
 * (city dithered, district dashed, county dotted), each geocoder's point,
 * the margin circle and the line to the nearest edge. Everything drawn here
 * comes from the API's response; nothing from the search box.
 */
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString, Point, Position } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { LonLat, RatePart, Trace } from '$lib/api';
import { distance, GEOCODER_NAME, nearestEdge, outlineFor, pct } from '$lib/result/format';
import { circle } from './circle';
import type { MapTheme } from './style';

/** The page's tokens as plain colours (MapLibre can't read CSS variables). */
export const MAP_COLORS = {
	light: {
		ink: '#1f1f1f',
		muted: '#767676',
		bg: '#faf9f5',
		accent: '#2563eb',
		city: '#29508a',
		district: '#8c3441',
		county: '#5b5b5b',
		dither: [41, 80, 138, 46] as const
	},
	dark: {
		ink: '#e6e6e6',
		muted: '#9a9a9a',
		bg: '#1f1e1d',
		accent: '#6ea8fe',
		city: '#9dbcf0',
		district: '#f0a3ad',
		county: '#a3a3a3',
		dither: [157, 188, 240, 40] as const
	}
} satisfies Record<MapTheme, Record<string, unknown>>;

const PREFIX = 'otr-';
const SOURCES = ['outlines', 'outline-lines', 'margin', 'edge', 'points'].map((s) => PREFIX + s);
const DITHER = PREFIX + 'dither';

/** A 6×6 tile with one 2×2 dot, offset on alternate rows by the tile's
 *  repeat: a sparse pixel "dither" for the city fill, quiet enough to read
 *  the streets through. */
function ditherImage(rgba: readonly [number, number, number, number]) {
	const size = 6;
	const data = new Uint8Array(size * size * 4);
	const dot = (x0: number, y0: number) => {
		for (let y = y0; y < y0 + 2; y++) for (let x = x0; x < x0 + 2; x++) data.set(rgba, (y * size + x) * 4);
	};
	dot(0, 0);
	dot(3, 3);
	return { width: size, height: size, data };
}

export interface TraceView {
	trace: Trace;
	parts: RatePart[];
	/** A refusal: outlines inside the margin are what it was too close to. */
	refused: boolean;
}

const collection = <G extends Geometry>(features: Feature<G>[]): FeatureCollection<G> => ({
	type: 'FeatureCollection',
	features
});

function outlineLabel(o: Trace['outlines'][number], parts: RatePart[]): string {
	if (!o.inside) return `${o.name} · outside`;
	if (!o.levies) return `${o.name} · levies none`;
	const part = parts.find((p) => outlineFor(p, [o]) === o);
	return part ? `${o.name} · levies ${pct(part.rate, true)}` : `${o.name} · levies`;
}

const KIND_GROUP: Record<string, 'place' | 'district' | 'county'> = {
	place: 'place',
	cousub: 'place',
	district: 'district',
	county: 'county'
};

/**
 * An outline's real edges as lines. The API clips each outline to a box
 * around the point, which adds straight edges along the box that aren't
 * borders; those segments (on the geometry's own bounding box, running
 * along it) are left out so the map doesn't draw a line that isn't there.
 */
export function edgeLines(geometry: Geometry): MultiLineString {
	const rings: Position[][] =
		geometry.type === 'Polygon' ? geometry.coordinates : geometry.type === 'MultiPolygon' ? geometry.coordinates.flat() : [];
	let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
	for (const ring of rings)
		for (const [x, y] of ring) {
			minX = Math.min(minX, x);
			minY = Math.min(minY, y);
			maxX = Math.max(maxX, x);
			maxY = Math.max(maxY, y);
		}
	const eps = 1e-6;
	const onBox = (a: Position, b: Position) =>
		(Math.abs(a[0] - b[0]) < eps && (Math.abs(a[0] - minX) < eps || Math.abs(a[0] - maxX) < eps)) ||
		(Math.abs(a[1] - b[1]) < eps && (Math.abs(a[1] - minY) < eps || Math.abs(a[1] - maxY) < eps));
	const lines: Position[][] = [];
	for (const ring of rings) {
		let current: Position[] = [];
		for (let i = 1; i < ring.length; i++) {
			if (onBox(ring[i - 1], ring[i])) {
				if (current.length > 1) lines.push(current);
				current = [];
				continue;
			}
			if (current.length === 0) current.push(ring[i - 1]);
			current.push(ring[i]);
		}
		if (current.length > 1) lines.push(current);
	}
	return { type: 'MultiLineString', coordinates: lines };
}

export function clearTrace(map: MapLibreMap) {
	const style = map.getStyle();
	for (const layer of style?.layers ?? []) if (layer.id.startsWith(PREFIX)) map.removeLayer(layer.id);
	for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
}

/** Draws the trace; returns the points the camera should fit. */
export function drawTrace(map: MapLibreMap, view: TraceView, theme: MapTheme, font: string[]): LonLat[] {
	clearTrace(map);
	const c = MAP_COLORS[theme];
	const { trace } = view;
	const margin = trace.point?.marginMetres ?? 0;

	if (map.hasImage(DITHER)) map.removeImage(DITHER);
	map.addImage(DITHER, ditherImage(c.dither), { pixelRatio: 1 });

	const outlines = collection(
		trace.outlines
			.filter((o) => o.geometry)
			.map((o) => ({
				type: 'Feature' as const,
				geometry: o.geometry as Geometry,
				properties: {
					group: KIND_GROUP[o.kind] ?? 'district',
					inside: o.inside,
					close: view.refused && trace.point !== undefined && o.edgeMetres <= margin,
					label: outlineLabel(o, view.parts)
				}
			}))
	);
	map.addSource(PREFIX + 'outlines', { type: 'geojson', data: outlines });
	map.addSource(PREFIX + 'outline-lines', {
		type: 'geojson',
		data: collection(outlines.features.map((f) => ({ ...f, geometry: edgeLines(f.geometry) })))
	});

	const lineColor = (base: string) => ['case', ['get', 'close'], c.accent, base] as unknown as string;
	const lineWidth = ['case', ['get', 'close'], 2.6, ['get', 'inside'], 1.6, 1] as unknown as number;
	const lineOpacity = ['case', ['get', 'inside'], 1, 0.55] as unknown as number;

	map.addLayer({
		id: PREFIX + 'place-fill',
		type: 'fill',
		source: PREFIX + 'outlines',
		filter: ['all', ['==', ['get', 'group'], 'place'], ['get', 'inside']],
		paint: { 'fill-pattern': DITHER }
	});
	map.addLayer({
		id: PREFIX + 'county-line',
		type: 'line',
		source: PREFIX + 'outline-lines',
		filter: ['==', ['get', 'group'], 'county'],
		layout: { 'line-cap': 'round' },
		paint: { 'line-color': lineColor(c.county), 'line-width': lineWidth, 'line-dasharray': [0.1, 2.4], 'line-opacity': lineOpacity }
	});
	map.addLayer({
		id: PREFIX + 'district-line',
		type: 'line',
		source: PREFIX + 'outline-lines',
		filter: ['==', ['get', 'group'], 'district'],
		paint: { 'line-color': lineColor(c.district), 'line-width': lineWidth, 'line-dasharray': [4, 3], 'line-opacity': lineOpacity }
	});
	map.addLayer({
		id: PREFIX + 'place-line',
		type: 'line',
		source: PREFIX + 'outline-lines',
		filter: ['==', ['get', 'group'], 'place'],
		paint: { 'line-color': lineColor(c.city), 'line-width': lineWidth, 'line-opacity': lineOpacity }
	});
	map.addLayer({
		id: PREFIX + 'outline-label',
		type: 'symbol',
		source: PREFIX + 'outline-lines',
		layout: {
			'symbol-placement': 'line',
			'symbol-spacing': 420,
			'text-field': ['get', 'label'],
			'text-font': font,
			'text-size': 11.5,
			'text-offset': [0, -0.9],
			'text-max-angle': 30
		},
		paint: {
			'text-color': [
				'case',
				['get', 'close'],
				c.accent,
				['match', ['get', 'group'], 'place', c.city, 'district', c.district, c.county]
			] as unknown as string,
			'text-halo-color': c.bg,
			'text-halo-width': 1.6
		}
	});

	const fit: LonLat[] = [];
	if (trace.point) {
		const ring = circle(trace.point, trace.point.marginMetres);
		map.addSource(PREFIX + 'margin', { type: 'geojson', data: { type: 'Feature', geometry: ring, properties: {} } });
		map.addLayer({
			id: PREFIX + 'margin-fill',
			type: 'fill',
			source: PREFIX + 'margin',
			paint: { 'fill-color': c.accent, 'fill-opacity': 0.08 }
		});
		map.addLayer({
			id: PREFIX + 'margin-line',
			type: 'line',
			source: PREFIX + 'margin',
			paint: { 'line-color': c.accent, 'line-width': 1.6, 'line-dasharray': [2.5, 2] }
		});
		for (const [lon, lat] of ring.coordinates[0]) fit.push({ lon, lat });

		const near = nearestEdge(trace);
		if (near && near.edgeMetres > 1) {
			const line: Feature<LineString> = {
				type: 'Feature',
				geometry: {
					type: 'LineString',
					coordinates: [
						[trace.point.lon, trace.point.lat],
						[near.foot.lon, near.foot.lat]
					]
				},
				properties: {
					label: `nearest ${near.kind === 'county' ? 'county' : near.kind === 'district' ? 'district' : 'city'} edge ${distance(near.edgeMetres)}`
				}
			};
			map.addSource(PREFIX + 'edge', { type: 'geojson', data: line });
			map.addLayer({
				id: PREFIX + 'edge-line',
				type: 'line',
				source: PREFIX + 'edge',
				paint: { 'line-color': c.ink, 'line-width': 1.2, 'line-dasharray': [2, 2], 'line-opacity': 0.75 }
			});
			map.addLayer({
				id: PREFIX + 'edge-label',
				type: 'symbol',
				source: PREFIX + 'edge',
				layout: {
					'symbol-placement': 'line-center',
					'text-field': ['get', 'label'],
					'text-font': font,
					'text-size': 12,
					'text-offset': [0, -0.8],
					'text-allow-overlap': true
				},
				paint: { 'text-color': c.ink, 'text-halo-color': c.bg, 'text-halo-width': 2 }
			});
			fit.push(near.foot);
		}
	}

	// Mapbox's points aren't drawn: its terms keep them to Mapbox maps. The
	// list says so in words instead.
	const points = collection<Point>(
		trace.geocoders
			.filter((g) => g.source !== 'mapbox')
			.map((g) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
				properties: {
					used: trace.point?.source === g.source,
					label: `${GEOCODER_NAME[g.source] ?? g.source} · ${g.accuracy}${trace.point?.source === g.source ? ' (used)' : ''}`
				}
			}))
	);
	map.addSource(PREFIX + 'points', { type: 'geojson', data: points });
	map.addLayer({
		id: PREFIX + 'points',
		type: 'circle',
		source: PREFIX + 'points',
		paint: {
			'circle-radius': 4.5,
			'circle-color': ['case', ['get', 'used'], c.accent, c.bg] as unknown as string,
			'circle-stroke-color': ['case', ['get', 'used'], c.accent, c.ink] as unknown as string,
			'circle-stroke-width': 1.6
		}
	});
	map.addLayer({
		id: PREFIX + 'points-label',
		type: 'symbol',
		source: PREFIX + 'points',
		minzoom: 15,
		layout: {
			'text-field': ['get', 'label'],
			'text-font': font,
			'text-size': 11.5,
			'text-anchor': 'left',
			'text-offset': [0.9, 0],
			'text-allow-overlap': false
		},
		paint: { 'text-color': c.ink, 'text-halo-color': c.bg, 'text-halo-width': 1.8 }
	});
	if (fit.length === 0) for (const g of trace.geocoders) fit.push(g);
	return fit;
}
