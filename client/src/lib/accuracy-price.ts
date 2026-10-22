import benchmark from './benchmark.json';
import { pricing } from './pricing';

export type Point = {
	id: string;
	name: string;
	price: number;
	accuracy: number;
	asked: number;
	right: number;
	conditional: boolean;
	note: string;
};

/** No worse on both axes, strictly better on at least one. Conditional
 * prices and separate samples must never establish or defeat a frontier claim. */
export function isDominated(point: Point, points: Point[]): boolean {
	return points.some((other) => !other.conditional && !point.conditional &&
		other.price <= point.price && other.accuracy >= point.accuracy &&
		(other.price < point.price || other.accuracy > point.accuracy));
}

export const points: Point[] = pricing.rows.flatMap((row) => {
	const scenario = row.comparison;
	const result = benchmark.services.find((s) => s.id === (scenario?.benchmarkId ?? row.id));
	if (!scenario || !result) return [];
	return [{ id: row.id, name: row.name, price: scenario.perThousand,
		accuracy: result.right / result.asked * 100, asked: result.asked,
		right: result.right, conditional: scenario.conditional, note: scenario.note }];
});
