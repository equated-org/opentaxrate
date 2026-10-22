import { redirect } from '@sveltejs/kit';
import { ACCOUNTS } from '$lib/accounts';

export function load() {
	if (!ACCOUNTS) redirect(307, '/');
}
