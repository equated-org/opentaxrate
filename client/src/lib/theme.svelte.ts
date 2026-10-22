/** The theme follows the OS (prefers-color-scheme); there's no toggle and
 *  nothing is stored. The inline script in app.html sets `.dark` before
 *  first paint; this keeps a reactive copy for the map's style. */
const query = '(prefers-color-scheme: dark)';

let resolved = $state<'light' | 'dark'>(
	typeof window !== 'undefined' && window.matchMedia(query).matches ? 'dark' : 'light'
);

export function initTheme() {
	const mql = window.matchMedia(query);
	const apply = () => {
		resolved = mql.matches ? 'dark' : 'light';
		document.documentElement.classList.toggle('dark', mql.matches);
	};
	apply();
	mql.addEventListener('change', apply);
	return () => mql.removeEventListener('change', apply);
}

export const theme = {
	/** The theme on screen, for the map's style. */
	get resolved() {
		return resolved;
	}
};
