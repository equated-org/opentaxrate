import type { Polygon } from 'geojson';
import type { LonLat } from '$lib/api';

const EARTH_RADIUS = 6_371_008.8;

/** A circle of `metres` radius around `center`, as a polygon of `steps`
 *  points on the sphere (good to well under a metre at these sizes). */
export function circle(center: LonLat, metres: number, steps = 72): Polygon {
	const lat1 = (center.lat * Math.PI) / 180;
	const lon1 = (center.lon * Math.PI) / 180;
	const d = metres / EARTH_RADIUS;
	const ring: [number, number][] = [];
	for (let i = 0; i <= steps; i++) {
		const bearing = (2 * Math.PI * i) / steps;
		const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearing));
		const lon2 =
			lon1 + Math.atan2(Math.sin(bearing) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
		ring.push([(lon2 * 180) / Math.PI, (lat2 * 180) / Math.PI]);
	}
	return { type: 'Polygon', coordinates: [ring] };
}

/** Metres between two points (equirectangular; fine under a few km). */
export function metresBetween(a: LonLat, b: LonLat): number {
	const kx = 111_320 * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
	return Math.hypot((a.lon - b.lon) * kx, (a.lat - b.lat) * 110_540);
}
