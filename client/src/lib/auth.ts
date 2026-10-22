/**
 * The dashboard's client for accounts: sign-in by emailed code and API
 * keys, through /api/auth on this origin (the Worker forwards it to the API,
 * so the session cookie is first-party), and the account reads under
 * /v1/account.
 */
import { createAuthClient } from 'better-auth/svelte';
import { emailOTPClient } from 'better-auth/client/plugins';
import { apiKeyClient } from '@better-auth/api-key/client';

export const authClient = createAuthClient({
	basePath: '/api/auth',
	plugins: [emailOTPClient(), apiKeyClient()]
});

export interface Summary {
	email: string;
	creditMicros: number;
	priceMicros: number;
	lookupsLeft: number;
	month: { lookups: number; charged: number; declined: number; chargedMicros: number };
	lookupsByKey: Record<string, number>;
	/** Whether credit can be bought yet, and in what range (whole dollars). */
	canBuy: boolean;
	topUpCents: { min: number; max: number };
}

export interface RequestRow {
	id: number;
	at: string;
	keyId: string;
	query: Record<string, string>;
	status: number;
	response: Record<string, unknown>;
	cached: boolean;
	providers: string[];
	chargedMicros: number;
	ms: number;
}

/** GET a /v1/account path with the session cookie; null when signed out. */
export async function account<T>(path: string): Promise<T | null> {
	const response = await fetch(`/v1/account/${path}`, { credentials: 'same-origin' });
	if (response.status === 401) return null;
	if (!response.ok) throw new Error(`The dashboard couldn't load (${response.status}).`);
	return response.json() as Promise<T>;
}

export const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
export const perThousand = (priceMicros: number) => `$${(priceMicros / 1000).toFixed(2)}`;

/** Credits the Checkout session the buyer came back from; true once it's
 *  paid. */
export async function confirmPayment(session: string) {
	const response = await fetch('/v1/account/checkout/confirm', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ session })
	});
	return response.ok && ((await response.json()) as { paid?: boolean }).paid === true;
}

/** Starts a Stripe Checkout for a top-up (cents) and goes there. */
export async function buyCredit(cents: number) {
	const response = await fetch('/v1/account/checkout', {
		method: 'POST',
		credentials: 'same-origin',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ amount: cents })
	});
	const body = (await response.json()) as { url?: string; error?: string };
	if (!response.ok || !body.url) throw new Error(body.error ?? "Checkout couldn't start.");
	location.assign(body.url);
}
