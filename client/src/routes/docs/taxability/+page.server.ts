// The codes and their definitions, read from the API's own list
// (src/taxability/codes.ts) when the page is prerendered, so the page
// can't fall behind what code= accepts.
import { TAX_CODES } from '../../../../../src/taxability/codes';

export function load() {
	return { codes: Object.entries(TAX_CODES) as Array<[string, string]> };
}
