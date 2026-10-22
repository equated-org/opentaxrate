import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// Plain files: index.html, JS and CSS. Any static host serves them.
		adapter: adapter({ pages: 'build', assets: 'build', fallback: undefined, strict: true })
	}
};

export default config;
