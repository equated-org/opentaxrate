/** The signed-in account's summary, shared by the dashboard's pages. */
import { rememberSignedIn } from './accounts';
import { account, type Summary } from './auth';

let summary = $state<Summary | null>(null);
let signedOut = $state(false);

export const dashboard = {
	get summary() {
		return summary;
	},
	get signedOut() {
		return signedOut;
	},
	async refresh() {
		const next = await account<Summary>('summary');
		signedOut = next === null;
		summary = next;
		rememberSignedIn(!signedOut);
	}
};
