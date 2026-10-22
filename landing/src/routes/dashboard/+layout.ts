import { redirect } from '@sveltejs/kit';
import { ACCOUNTS } from '$lib/accounts';

// Signed-in pages: a static shell that loads the account in the browser.
export const ssr = false;

export function load() {
	if (!ACCOUNTS) redirect(307, '/');
}
