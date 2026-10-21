// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {}

	/** Build-time settings; see .env.example. */
	interface ImportMetaEnv {
		readonly PUBLIC_API_URL?: string;
		readonly PUBLIC_SUGGEST?: 'photon' | 'geoapify' | string;
		readonly PUBLIC_PHOTON_URL?: string;
		readonly PUBLIC_GEOAPIFY_KEY?: string;
	}
}

export {};
