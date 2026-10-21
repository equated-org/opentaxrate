/** Light, dark or follow the system. Kept in localStorage (no cookies); the
 *  inline script in app.html applies it before first paint. */
export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'opentaxrate-theme';

let preference = $state<ThemePreference>(initial());
let resolved = $state<'light' | 'dark'>('light');

function initial(): ThemePreference {
	if (typeof window === 'undefined') return 'system';
	try {
		const stored = localStorage.getItem(STORAGE_KEY);
		if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
	} catch {
		// Storage blocked: follow the system.
	}
	return 'system';
}

function systemTheme(): 'light' | 'dark' {
	if (typeof window === 'undefined') return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(pref: ThemePreference) {
	resolved = pref === 'system' ? systemTheme() : pref;
	document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function initTheme() {
	apply(preference);
	const mql = window.matchMedia('(prefers-color-scheme: dark)');
	const onChange = () => {
		if (preference === 'system') apply('system');
	};
	mql.addEventListener('change', onChange);
	return () => mql.removeEventListener('change', onChange);
}

export function setTheme(pref: ThemePreference) {
	preference = pref;
	try {
		localStorage.setItem(STORAGE_KEY, pref);
	} catch {
		// Not persisted; still applied for this visit.
	}
	apply(pref);
}

export const theme = {
	get preference() {
		return preference;
	},
	/** The theme on screen, for the map's style. */
	get resolved() {
		return resolved;
	}
};
