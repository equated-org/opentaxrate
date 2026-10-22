/**
 * Whether this build has sign-in and the dashboard (PUBLIC_ACCOUNTS=on).
 * Off by default, so a self-hosted site shows no "Sign in" for an API
 * without accounts; opentaxrate.com builds with it on. With it off, /login
 * and /dashboard send you home.
 */
export const ACCOUNTS = import.meta.env.PUBLIC_ACCOUNTS === 'on';

/** A hint, kept by the dashboard, that this browser is signed in: the
 *  session cookie is httpOnly, and the public pages shouldn't ask the API
 *  for every visitor. The dashboard checks the real session either way. */
const HINT = 'otr-signed-in';

export function rememberSignedIn(on: boolean) {
	try {
		if (on) localStorage.setItem(HINT, '1');
		else localStorage.removeItem(HINT);
	} catch {
		// Storage blocked: the public pages just won't know.
	}
}

export function seemsSignedIn() {
	try {
		return ACCOUNTS && localStorage.getItem(HINT) === '1';
	} catch {
		return false;
	}
}
