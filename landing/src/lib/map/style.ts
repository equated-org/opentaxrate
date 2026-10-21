/**
 * OpenFreeMap's Positron, greyed and quieted so the engine's marks are the
 * only colour on the map, with a dark variant made from the same style. The
 * labels stay (a visitor has to recognise the place); shields and the hill
 * shading go.
 */
import type { StyleSpecification } from 'maplibre-gl';

export const BASE_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export type MapTheme = 'light' | 'dark';

let base: Promise<StyleSpecification> | undefined;

function fetchBase(): Promise<StyleSpecification> {
	base ??= fetch(BASE_STYLE_URL).then((r) => {
		if (!r.ok) throw new Error(`OpenFreeMap style answered ${r.status}`);
		return r.json() as Promise<StyleSpecification>;
	});
	base.catch(() => (base = undefined));
	return base;
}

type Rgba = [number, number, number, number];

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	const k = (n: number) => (n + h / 30) % 12;
	const a = s * Math.min(l, 1 - l);
	const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
	return [f(0), f(8), f(4)];
}

/** A CSS colour string as 0..1 channels, or null if it isn't one we read. */
export function parseColor(value: string): Rgba | null {
	const v = value.trim().toLowerCase();
	if (v === 'white') return [1, 1, 1, 1];
	if (v === 'black') return [0, 0, 0, 1];
	if (v === 'transparent') return [0, 0, 0, 0];
	let m = v.match(/^#([0-9a-f]{3,8})$/);
	if (m) {
		let hex = m[1];
		if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
		const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
		return [n(0), n(2), n(4), hex.length === 8 ? n(6) : 1];
	}
	m = v.match(/^rgba?\(([^)]+)\)$/);
	if (m) {
		const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
		return [Number(r) / 255, Number(g) / 255, Number(b) / 255, Number(a)];
	}
	m = v.match(/^hsla?\(([^)]+)\)$/);
	if (m) {
		const [h, s, l, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
		const [r, g, b] = hslToRgb(parseFloat(h), parseFloat(s) / 100, parseFloat(l) / 100);
		return [r, g, b, Number(a)];
	}
	return null;
}

/** A warm grey of lightness `l`, toned to the page's ivory ground: a touch
 *  more red than blue, so the map sits on the page instead of looking cold. */
const grey = (l: number, a: number) => {
	const ch = (k: number) => Math.round(Math.max(0, Math.min(1, l * k)) * 255);
	const [r, g, b] = [ch(1.0), ch(0.985), ch(0.955)];
	return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+a.toFixed(3)})`;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

type Role = 'surface' | 'text' | 'halo' | 'boundary';

/** Where a colour of lightness `l` lands for a role and theme. Positron's
 *  surfaces sit between 0.75 (water) and 1 (roads); squeeze them into a
 *  narrow band so the basemap reads as paper, not as a map competing with
 *  the outlines. */
function remap(l: number, role: Role, theme: MapTheme): number {
	const t = clamp01((l - 0.75) / 0.25);
	if (theme === 'light') {
		if (role === 'surface') return 0.905 + t * 0.085;
		if (role === 'boundary') return 0.8;
		if (role === 'halo') return 0.975;
		return 0.48 + l * 0.26;
	}
	if (role === 'surface') return 0.075 + t * 0.075;
	if (role === 'boundary') return 0.3;
	if (role === 'halo') return 0.09;
	return 0.6 - l * 0.22;
}

function mapColors(value: unknown, role: Role, theme: MapTheme): unknown {
	if (typeof value === 'string') {
		const c = parseColor(value);
		if (!c) return value;
		const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
		return grey(remap(l, role, theme), c[3]);
	}
	if (Array.isArray(value)) return value.map((v) => mapColors(v, role, theme));
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) out[k] = mapColors(v, role, theme);
		return out;
	}
	return value;
}

const HIDDEN = /shield|^aeroway|^railway.*dashline$/;

/** The muted basemap for a theme. The fetch is shared between calls. */
export async function mutedStyle(theme: MapTheme): Promise<StyleSpecification> {
	const style = structuredClone(await fetchBase());
	style.layers = style.layers
		.filter((layer) => layer.type !== 'raster' && layer.type !== 'hillshade' && !HIDDEN.test(layer.id))
		.map((layer) => {
			if (!('paint' in layer) || !layer.paint) return layer;
			const paint: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(layer.paint)) {
				if (!key.endsWith('color')) {
					paint[key] = value;
					continue;
				}
				const role: Role = key.includes('halo')
					? 'halo'
					: key.startsWith('text') || key.startsWith('icon')
						? 'text'
						: layer.id.startsWith('boundary')
							? 'boundary'
							: 'surface';
				paint[key] = mapColors(value, role, theme);
			}
			return { ...layer, paint } as typeof layer;
		});
	return style;
}

/** A plain background with OpenFreeMap's glyphs, for when the basemap
 *  can't load: the trace still draws, like a blueprint. */
export function blankStyle(theme: MapTheme): StyleSpecification {
	return {
		version: 8,
		glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
		sources: {},
		layers: [{ id: 'background', type: 'background', paint: { 'background-color': theme === 'dark' ? '#1f1e1d' : '#faf9f5' } }]
	};
}

/** The first text font the base style uses, for our own labels. */
export function labelFont(style: StyleSpecification): string[] {
	const fonts = style.layers.flatMap((l) => (l.type === 'symbol' && Array.isArray(l.layout?.['text-font']) ? [l.layout['text-font'] as string[]] : []));
	const regular = fonts.find((f) => typeof f[0] === 'string' && f[0].endsWith('Regular'));
	if (regular) return regular;
	for (const layer of style.layers) {
		const font = layer.type === 'symbol' ? layer.layout?.['text-font'] : undefined;
		if (Array.isArray(font) && typeof font[0] === 'string') return font as string[];
	}
	return ['Noto Sans Regular'];
}
