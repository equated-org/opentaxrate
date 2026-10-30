// The pages the taxability rules cite, by place, read from the rule files
// (src/taxability/rules/us-XX.json, ca-*.json) when the page is prerendered.
// Only each page's URL, title and how many rules cite it reach the browser
// (about 140 KB of page data, against 3 MB of rule files).
import type { CitedPage, PlaceSources } from '$lib/evidence';
import { stateName } from '$lib/states';

interface Citation {
	url: string;
	title: string;
}
interface Rule {
	citations: Citation[];
}
// The same files readRuleFiles (src/taxability/rules/index.ts) reads.
const files = import.meta.glob<Rule[]>('../../../../src/taxability/rules/*.json', { eager: true, import: 'default' });

export function load() {
	const places: PlaceSources[] = [];
	for (const [path, rules] of Object.entries(files)) {
		const m = path.match(/\/(us|ca)-([A-Za-z]+)\.json$/);
		if (!m) continue;
		const place = m[2];
		const pages = new Map<string, CitedPage>();
		for (const rule of rules) {
			for (const url of new Set(rule.citations.map((c) => c.url))) {
				const page = pages.get(url);
				if (page) page.rules++;
				else pages.set(url, { url, title: rule.citations.find((c) => c.url === url)!.title, rules: 1 });
			}
		}
		places.push({
			place,
			country: m[1] === 'us' ? 'US' : 'CA',
			name: place === 'federal' ? 'Canada (GST/HST)' : stateName(place),
			rules: rules.length,
			pages: [...pages.values()].sort((a, b) => b.rules - a.rules || a.title.localeCompare(b.title))
		});
	}
	// The states and DC, then Canada.
	places.sort((a, b) => b.country.localeCompare(a.country) || a.name.localeCompare(b.name));
	return { taxabilitySources: places };
}
