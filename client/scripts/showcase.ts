// The landing's examples, checked against the live API, and the saved
// answers the showcase draws (src/lib/showcase-aurora.json).
//
//   pnpm showcase           check every example, then rewrite the saved answers
//   pnpm showcase --check   check only; exit 1 when an example no longer shows what it says
//
// API=http://localhost:8080 asks another API. It asks without a key, as a
// visitor's browser does, and waits between lookups for the public limit.
import { writeFileSync } from 'node:fs';
import { EXAMPLES, SAME_ZIP } from '../src/lib/examples.ts';
import { clipRing, ringsOf, type Point } from '../src/lib/map/clip.ts';

const api = (process.env.API ?? 'https://api.opentaxrate.com').replace(/\/+$/, '');
const checkOnly = process.argv.includes('--check');
const pause = api.startsWith('https://api.opentaxrate.com') ? 6500 : 0;

/** What each example's chip promises. */
const PROMISE: Record<string, (status: number, body: any) => boolean> = {
	'Columbus, OH': (status, body) => status === 200 && body.match === 'street',
	'Murphy, TX': (status, body) => status === 422 && body.code === 'ADDRESS_NEEDS_CONFIRMATION',
	'Portland, OR': (status, body) => status === 200 && body.rate === 0
};
/** The Aurora addresses' rates, as Colorado DOR's lookup gave them. */
const SAME_ZIP_RATES = [0.0425, 0.0675, 0.08];

let first = true;
async function ask(s: (typeof SAME_ZIP)[number]) {
	if (!first && pause) await new Promise((done) => setTimeout(done, pause));
	first = false;
	const params = new URLSearchParams({ state: s.state, street: s.street, city: s.city, zip: s.zip, include: 'trace' });
	const response = await fetch(`${api}/v1/rate?${params}`, { headers: { accept: 'application/json' } });
	return { status: response.status, body: (await response.json().catch(() => ({}))) as any };
}

const failures: string[] = [];
for (const e of EXAMPLES) {
	const promise = PROMISE[e.name];
	if (!promise) continue;
	const { status, body } = await ask(e.suggestion);
	const ok = promise(status, body);
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${e.name} (${e.note}): HTTP ${status} ${body.rate ?? body.code ?? ''} ${body.match ?? ''}`);
	if (!ok) failures.push(e.name);
}

const answers = [];
for (const [i, s] of SAME_ZIP.entries()) {
	const { status, body } = await ask(s);
	const ok = status === 200 && body.match === 'map' && Math.abs(body.rate - SAME_ZIP_RATES[i]) < 0.00005;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.label}: HTTP ${status} ${body.rate ?? body.code} ${body.match ?? ''}, want ${SAME_ZIP_RATES[i]} on the map`);
	if (!ok) failures.push(s.label);
	answers.push(body);
}

if (failures.length) {
	console.error(`\n${failures.length} example(s) no longer show what they say: ${failures.join('; ')}. Pick new ones in src/lib/examples.ts.`);
	process.exit(1);
}
if (checkOnly) process.exit(0);

// Keep only what the sketch draws: outlines clipped to a box well around the
// points, at about a metre's precision.
const lons = answers.map((a) => a.trace.point.lon);
const lats = answers.map((a) => a.trace.point.lat);
const padLon = Math.max(Math.max(...lons) - Math.min(...lons), 0.01) * 1.5;
const padLat = Math.max(Math.max(...lats) - Math.min(...lats), 0.01) * 1.5;
const box = { x0: Math.min(...lons) - padLon, x1: Math.max(...lons) + padLon, y0: Math.min(...lats) - padLat, y1: Math.max(...lats) + padLat };
const round = ([x, y]: Point): Point => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];

function clipped(geometry: unknown) {
	const rings = ringsOf(geometry)
		.map((ring) => clipRing(ring, box).map(round))
		.filter((ring) => ring.length >= 3);
	return rings.length ? { type: 'MultiPolygon', coordinates: rings.map((ring) => [ring]) } : undefined;
}

const saved = {
	asOf: new Date().toISOString().slice(0, 10),
	answers: answers.map(({ trace, ...rate }) => ({
		...rate,
		trace: {
			point: trace.point,
			geocoders: [],
			outlines: trace.outlines.filter((o: any) => o.inside && o.levies).map((o: any) => ({ ...o, geometry: clipped(o.geometry) }))
		}
	}))
};
const out = new URL('../src/lib/showcase-aurora.json', import.meta.url);
writeFileSync(out, JSON.stringify(saved, null, 1) + '\n');
console.log(`\nwrote ${out.pathname} (${Math.round(JSON.stringify(saved).length / 1024)} KB)`);
