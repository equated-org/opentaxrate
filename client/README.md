# OpenTaxRate landing page

A one-page site: type a US address, see its sales tax rate split into state,
county, city and district parts, and a map of the points and outlines the
engine used to decide. It's a static SvelteKit build (adapter-static,
prerendered), so any static host can serve it. There's no server code, no
sign-in, no cookies and no analytics. The theme follows the OS
(prefers-color-scheme).

The browser talks to three services directly:

- the OpenTaxRate API: `GET {PUBLIC_API_URL}/v1/rate?…&include=trace`, once per lookup;
- the address autocomplete: Photon (default) or Geoapify, while typing;
- OpenFreeMap's tiles, drawn with MapLibre after the first result.

This app is standalone. It has its own `package.json` and lockfile, imports
nothing from `../src`, and the API's Docker build ignores it.

## Develop

```sh
cd client
pnpm install
cp .env.example .env     # then edit
pnpm dev                 # http://localhost:5173
pnpm check               # svelte-check + TypeScript
pnpm test                # unit tests (the address parser)
pnpm build               # static site in build/
pnpm preview             # serve build/ locally
```

Run the API from the repo root (`pnpm dev`, or `docker compose up`). A browser
can only call it if it sends CORS headers for this page's origin. If yours
doesn't, leave `PUBLIC_API_URL` empty in `.env`: the dev server then forwards
`/v1/*` to `API_PROXY_TARGET` (default `http://localhost:8080`).

### Fixtures (dev only)

`?fixture=austin|columbus|refusal|limited` answers from
`src/lib/fixtures/*.json` instead of the API, after a short delay. Use it with a
`q`, for example
`/?fixture=refusal&q=4700 E Riverside Dr, Austin, TX 78741`. The fixtures hold
real outlines from the loaded PostGIS data, but their points, distances and the
refusal's rates are illustrative. The switch and the JSON are left out of
production builds.

## Settings

All settings are build-time. Vite bakes `PUBLIC_*` values into the bundle, so
set them in the host's build environment. Changing one takes a rebuild.

| Variable | Default | What it does |
|---|---|---|
| `PUBLIC_API_URL` | `http://localhost:8080` | Base URL of the OpenTaxRate API. Empty means this page's own origin. |
| `PUBLIC_SUGGEST` | `photon` | Autocomplete provider: `photon` or `geoapify`. |
| `PUBLIC_PHOTON_URL` | `https://photon.komoot.io` | A Photon instance. Self-hosted ones need `-cors-any` to be called from a browser. |
| `PUBLIC_ACCOUNTS` | off | `on` shows "Sign in" and builds `/login` and `/dashboard`. Turn it on only for an API with accounts (`BETTER_AUTH_SECRET`); off, those pages send visitors home. opentaxrate.com builds with it on. |
| `PUBLIC_GEOAPIFY_KEY` | (none) | Required for `geoapify`. It ships in the bundle, so restrict it to your site's origins in Geoapify's console. The free plan stops at its daily cap rather than billing. |
| `API_PROXY_TARGET` | `http://localhost:8080` | Dev server only: where `/v1/*` is forwarded. |
| `PHOTON_PROXY_TARGET` | `https://photon.komoot.io` | Dev server only: where `/photon/*` is forwarded. Set `PUBLIC_PHOTON_URL=/photon` to reach a Photon that sends no CORS headers. |

## How a search runs

- Typing asks the autocomplete after 250 ms with at least 4 characters, and
  aborts the request before it. Arrow keys, Enter and Escape work, and the box
  is an ARIA combobox.
- The autocomplete often lacks the exact house. So a street (or a neighbour on
  the typed street) is offered with the typed house number, marked "from the
  street". Enter with nothing picked looks up the typed text itself, parsed by
  `src/lib/search/parse.ts`. Commas are optional, the state can be a code or a
  name, and the ZIP is optional.
- A lookup writes `?q=…` to the URL. Opening a URL with `?q=` runs the same
  search. `?q=A&vs=B&vs=C` looks up two or three addresses side by side
  (`src/lib/result/Compare.svelte`): a sketch of the outlines that tell them
  apart, drawn from their traces, over each full answer. The fields come from the text, and the point the map centers on
  comes from the autocomplete's best match in the same city.
- 200 shows the rate list and the map. 422 shows a refusal card with the rates
  it names, and the line it was too close to. 429 shows the wait from
  `Retry-After` and links to self-hosting. 5xx and network errors show a retry.

## Deploy

The output is `build/`, plain files. There are no functions or edge code.

### Vercel

1. New Project → import the repo.
2. **Root Directory**: `client`. Vercel detects SvelteKit and pnpm.
3. Build command `pnpm build`, output directory `build`. Set these explicitly
   if Vercel picks its own SvelteKit adapter output.
4. Environment variables: `PUBLIC_API_URL=https://api.opentaxrate.com`, and the
   autocomplete settings if you aren't using the default Photon.
5. Deploy. Add the production and preview origins to the API's CORS
   allow-list (`OPENTAXRATE_CORS_ORIGINS`).

The Hobby plan is for non-commercial use. A commercial site needs Pro, or
Cloudflare Pages.

### Cloudflare Pages

1. Workers & Pages → Create → Pages → connect the repo.
2. Framework preset: SvelteKit (or None). **Root directory**: `client`.
   **Build command**: `pnpm build`. **Build output directory**: `build`.
3. Environment variables: as for Vercel. Add `NODE_VERSION=22` if the
   default image's Node is older.
4. Deploy, then attach the custom domain.

You can also deploy without git:

```sh
cd client && pnpm build && npx wrangler pages deploy build --project-name opentaxrate
```

### Any other static host

Run `pnpm build` and upload `build/`. The site is a single `index.html`, and
`?q=` is read in the browser, so it needs no rewrites.

## Examples and the showcase

`src/lib/examples.ts` holds the chips under the search box and the three
Aurora, CO 80015 addresses (`SAME_ZIP`) the showcase draws: one ZIP, three tax
areas, each rate matching Colorado DOR's own lookup. The showcase's first
slide is one of them alone (its saved rate list beside `static/showcase-map*.webp`);
the second is all three, drawn from `src/lib/showcase-aurora.json`.

```bash
pnpm showcase --check   # every example still shows what its chip says, on the live API without a key
pnpm showcase           # the same, then rewrite showcase-aurora.json
```

The check runs in the [monthly maintenance](../docs/maintenance/cron.md). When
it fails, pick new examples rather than changing what the chips claim. The map
images are screenshots of the first slide's live result, light and dark.

## Public messaging

The landing page leads with street-address lookup, published sources and explicit
uncertainty, states what the service doesn't do (taxability, exemptions,
sourcing, filing), and shows the development benchmark with correct, wrong and declined
counts. `/sources` distinguishes tax boundaries from Census reference
geography; `/benchmarks` separates the held-out provider comparison from the
development benchmark. Scoring caveats and reproduction instructions live in
[the benchmark guide](../docs/benchmarks.md). Keep result dates and counts in
sync when updating these pages; `src/lib/benchmark.json` holds comparison data
and `src/lib/development-benchmark.json` holds the development results.

## Layout

```
src/routes/+page.svelte        the page: empty state, result state, ?q= handling
src/lib/search/                AddressSearch (combobox), suggest() over photon/geoapify, parse.ts
src/lib/api.ts                 /v1/rate call → LookupResult (rate | refusal | limited | failed)
src/lib/result/                RateList, Refusal, Limited, format.ts, TaxMap (lazy)
src/lib/map/                   muted OpenFreeMap style, trace layers, circle, inset
src/lib/pixel/                 the pixel art: wordmark, magnifier, pin, bar, progress, hourglass
static/fonts/                  Departure Mono for the wordmark (SIL OFL 1.1, license alongside)
static/hero-pin.webp           the hero image
static/showcase-map*.webp      saved map of the showcase's single address (light, dark)
src/lib/landing/               the empty page's showcase panel, contours and feature points
```

## Credits

Departure Mono (the wordmark) by Helena Zhang, Inter by Rasmus Andersson and
Geist Mono (the numbers) by Vercel, all under the SIL Open Font License; Inter
and Geist Mono via Fontsource. Map data
© OpenStreetMap contributors, tiles by OpenFreeMap and OpenMapTiles, and
rendering by MapLibre GL JS (BSD-3-Clause).
