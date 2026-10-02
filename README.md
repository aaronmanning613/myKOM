# myKOM

Web app that uses your Strava data to find the best KOMs to hunt in your area

## Running locally

### Prerequisites

- Node 22 (see `.nvmrc`; `nvm use` picks it up)
- pnpm via corepack: `corepack enable` (the version is pinned in `package.json`)
- Docker, for Postgres

### Setup

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Create your `.env` in the repo root from the example, and fill in your Strava API app credentials (from https://www.strava.com/settings/api, with the callback domain set to `localhost`):

   ```sh
   cp .env.example .env
   ```

   For place and postcode search, also set `NOMINATIM_USER_AGENT` to something that names the app and gives your contact, e.g. `myKOM/0.1 (you@example.com)`: [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires it. Without it, place search and reverse geocoding reply 503. The API calls Nominatim at most once a second and caches every search and reverse lookup in the `geocode_cache` table.

   For the IP-location fallback behind "Use my location" (optional), see [IP location](#ip-location) below.

   The other variables have working defaults for local development. `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` (which encrypts stored Strava tokens) fall back to development-only values with a warning; production requires both. `TICK_OIDC_AUDIENCE` and `TICK_SERVICE_ACCOUNT` are only for production's Cloud Scheduler (see [Background work](#background-work)). To sign in with Strava, open the web app at `http://localhost:5173` (not `127.0.0.1`), since that's the callback domain Strava accepts.

3. Start Postgres (Postgres 16 on host port 5433, data kept in a named volume):

   ```sh
   docker compose up -d --wait
   ```

4. Apply the database migrations:

   ```sh
   pnpm db:migrate
   ```

5. Start the API and web app together:

   ```sh
   pnpm dev
   ```

   - Web app: http://localhost:5173 (proxies `/api` to the API)
   - API: http://localhost:3001 (health check at `/api/health`)

### Other commands

| Command                 | What it does                                    |
| ----------------------- | ----------------------------------------------- |
| `pnpm test`             | Unit tests (Vitest) in every package, see below |
| `pnpm test:e2e`         | End-to-end tests (Playwright), see below        |
| `pnpm test:live`        | Opt-in tests against the real Strava account    |
| `pnpm test:e2e:live`    | Opt-in e2e tests signed in as the real Runner   |
| `pnpm dev:live`         | Dev servers in live test mode, see below        |
| `pnpm typecheck`        | TypeScript checks in every package              |
| `pnpm lint`             | ESLint and Prettier checks                      |
| `pnpm format`           | Format everything with Prettier                 |
| `pnpm build`            | Build every package                             |
| `pnpm db:generate`      | Generate a migration from the Drizzle schema    |
| `pnpm db:migrate`       | Apply pending migrations                        |
| `pnpm geolite2:update`  | Download the GeoLite2 City database, see below  |
| `pnpm strava:authorize` | Get a fresh token for the live Strava tests     |

`packages/shared` holds code both apps use. In development, tests and typechecks it is used straight from its TypeScript source; `pnpm build` also compiles it to `dist/`, which the built API loads through the `mykom-dist` export condition (`pnpm --dir apps/api start`).

### Background work

Strava reads that don't need to happen during a request (run details, Segment details, Mapped Areas and freshness re-fetches) go through a job queue in Postgres (`strava_jobs`), kept within Strava's rate limits by the budget in `strava_read_usage`. A search spends a first burst on its own jobs straight away, and `GET /api/results` drains for up to about 2 s while work is pending. Everything else runs on the **tick**, which drains the queue for about 20 s and, once a day, does housekeeping.

- In production, Cloud Scheduler calls `POST /internal/tick` every 5 minutes with a Google OIDC token. The route checks the token against `TICK_OIDC_AUDIENCE` and `TICK_SERVICE_ACCOUNT` and refuses every call while they're unset. See [docs/deploy.md](docs/deploy.md).
- Outside production, the API ticks itself every 5 minutes (logged as `Tick`), so `pnpm dev` keeps crawling on its own. In test mode, `POST /internal/tick` also works without a token.

### Debugging results

Outside production, `GET /api/debug/segments` (signed in) lists every Known Segment in the Search Area with the same pipeline as `GET /api/results`: its distance from the centre, the list it landed in, or why it's in none (the exclusion reason, plus the record status when there's no Target Record). Open it in the browser while signed in, e.g. http://localhost:5173/api/debug/segments. It makes no Strava calls.

### The Segment map

The Results page draws Your targets and Nearest misses on a Leaflet map (a lazily loaded chunk), using only stored geometry: a Segment's full route when its polyline is stored, otherwise its start point. It never fetches geometry from Strava. Each results list shows its top 20 Segments, with a "Show N more" button for the next 20 (paging is client-side; the API still returns every row), and the map draws only the rows the lists are showing. "Show more" adds Segments to the map without moving the view. Every route has a green start, a black finish (a ring when the route ends within 25 m of its start) and a direction arrow at its halfway point. A Segment known only by its start point is a single dot in its list's colour.

The Search Area page has a map too (its own lazy chunk; the form works without it). It shows the chosen centre as an orange pin with the radius drawn around it. Tapping or clicking the map drops the pin, and dragging it fine-tunes it. The centre is labelled "Dropped pin" straight away, then gets a place name from `GET /api/geocode/reverse`, which goes through the same 1 request per second Nominatim throttle and `geocode_cache` as place search. A place search, "Use my location" or a radius change moves the pin and refits the map; a drop or drag leaves the view where it is.

Tiles come from OpenStreetMap's standard tile server (`tile.openstreetmap.org`, no API key), attributed to OpenStreetMap contributors, which myKOM's handful of Runners keeps well within the [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). Leaflet stays out of the main bundle: both maps' chunks share it.

### Deploying

Pushes to `main` deploy to Cloud Run through `.github/workflows/deploy.yml`. The one-time setup (GCP, Supabase, Strava and GitHub) is in [docs/deploy.md](docs/deploy.md). The production image (`Dockerfile`) serves the built web app from the API.

### IP location

When the browser can't give the Runner's location, the Search Area screen falls back to `GET /api/locate-ip`, which looks up the client's IP address in MaxMind's free GeoLite2 City database. The database isn't in the repo; without it the API still starts and the lookup replies `{ "available": false, "reason": "no_database" }`. To install it:

1. Sign up for a free MaxMind account at https://www.maxmind.com/en/geolite2/signup and generate a license key.
2. Set `MAXMIND_LICENSE_KEY` in `.env`. The database goes to `data/geolite2/GeoLite2-City.mmdb` (git-ignored) unless you set `GEOLITE2_CITY_DB`.
3. Download it, then restart the API (it opens the file at startup):

   ```sh
   pnpm geolite2:update
   ```

MaxMind updates GeoLite2 twice a week and its licence asks you to keep it current, so re-run the script regularly (e.g. weekly from cron).

The lookup uses the address the request came from. Locally that's a loopback address, which isn't in the database, so the lookup reports `not_found`. When the API runs behind a reverse proxy, set `TRUST_PROXY` (comma-separated proxy addresses/CIDRs, or `true` to trust any) so the real client address is taken from `X-Forwarded-For`; leave it empty otherwise, or clients could spoof their address.

### Unit tests

`pnpm test` runs Vitest in every package. The API's tests need Postgres running (`docker compose up -d --wait`): they create and migrate a separate `mykom_test` database (or use `TEST_DATABASE_URL`), so they never touch your development data.

### End-to-end tests

`pnpm test:e2e` runs the Playwright tests in `e2e/` against your installed Google Chrome (no browser download). Postgres must be running (`docker compose up -d --wait`); Playwright migrates the database and starts its own API (port 3101) and web app (port 5174), so it doesn't clash with `pnpm dev`.

The e2e servers run in **test mode** (`NODE_ENV=test` or `E2E=1`, ignored when `NODE_ENV=production`): the API adds `POST /api/test/login`, which creates a throwaway Runner and signs the browser in, and swaps Strava for a local stand-in, so the tests never use real Strava credentials. These throwaway Runners stay in your development database.

The tests never fetch real map tiles. Every spec imports `test` and `expect` from `e2e/tests/fixtures.ts` (ESLint bans importing them straight from `@playwright/test`), whose automatic `tiles` fixture answers every `https://tile.openstreetmap.org/**` request with a bundled blank 256×256 PNG and records the requests, so a spec can assert none left for the real server.

To stop Postgres, run `docker compose down` (add `-v` to also delete the data).

### Live Strava tests

Every test above mocks Strava. These opt-in suites run against the Runner's **real Strava account** instead, using a real OAuth token rather than a password. They are not part of `pnpm test` or `pnpm test:e2e`, and they skip with a message (rather than fail) when there's no live token.

- `pnpm test:live` (Vitest, `apps/api/src/**/*.live.test.ts`): getting a valid access token, refreshing it and saving the rotated token; that the real `GET /athlete` response has the fields myKOM relies on and maps to a valid Runner (inside a rolled-back transaction on `mykom_test`); and that the granted scopes include everything myKOM asks for. It makes about 2 Strava calls and logs the rate-limit usage at the end.
- `pnpm test:e2e:live` (Playwright, `e2e/live/`): servers start in **live test mode** (`E2E_LIVE=1`, never in production) on ports 3201/5274 with their own database, `mykom_e2e_live` (override with `E2E_LIVE_DATABASE_URL`). A test-only route, `POST /api/test/login-live`, takes no token from the browser: the server reads the token file, fetches the real athlete and signs in as them (the first time, it also runs a real first sign-in's sync: every run, the generated Fitness Profile and the starred Segments). The tests check the header shows the real first name and avatar, that Fitness Profile and Search Area load and save, and Log out. A smoke test then runs a real 1 km search around the start of the Runner's latest run and checks it returns ranked rows within 30 Strava reads, counted by the app's own usage counters (`GET /api/test/live-reads`). To keep within that, it first raises the Runner's daily read counter so only 25 background reads are left today (`POST /api/test/live-read-allowance`). The first run on a fresh `mykom_e2e_live` reads the whole activity list (about a minute, and one read per 200 activities); after that the suite makes about 10 Strava calls plus up to 30 for the search.
- `pnpm dev:live` runs the dev servers (ports 3001/5173) in live test mode against `mykom_e2e_live`, for clicking through as the real Runner: open http://localhost:5173 and run `fetch('/api/test/login-live', { method: 'POST' })` in the console, then reload. It shares `mykom_e2e_live` with `pnpm test:e2e:live`, so after the smoke test has run, the real Runner's background work there waits until the next UTC day (the results page says it continues tomorrow).

**The token.** The live token lives in `.strava-live-token.json` at the repo root (git-ignored, mode 0600; never commit it). The first time, it's seeded from `STRAVA_REFRESH_TOKEN`, `STRAVA_ACCESS_TOKEN` and `STRAVA_TOKEN_EXPIRES_AT` in `.env`. Strava can hand out a new refresh token on every refresh, so the file always holds the latest one and is preferred over `.env`. If the token is lost or revoked, run `pnpm strava:authorize`: it prints Strava's authorize URL; open it, approve, and paste back the URL you're redirected to (`http://localhost/exchange_token?...`, which won't load, which is fine). The script exchanges the code and writes the token file, printing only your athlete id, first name and granted scopes.

**Never Disconnect with the live token.** Disconnect calls Strava's deauthorize, which revokes the token, and you'd have to re-consent with `pnpm strava:authorize`. In live test mode deauthorize is blocked: `POST /api/auth/disconnect` replies 403 `deauthorize_blocked` and deletes nothing. Don't click Disconnect while signed in live; Disconnect stays covered by the mocked tests only. Never use a Strava password or automate Strava's login or approval pages either.

**Rate limits.** Strava allows the app 200 read requests per 15 minutes and 2,000 per day (400 and 4,000 for all requests), shared by everything using the app (including real sign-ins). Run the live suites sparingly, e.g. before a release rather than on every change.

### Manual checks

The automated tests never touch real Strava, real browser location prompts or real Nominatim, so check these by hand before a release. Run `pnpm dev` (without `E2E=1`), with your Strava credentials and `NOMINATIM_USER_AGENT` in `.env`, and open http://localhost:5173 (not `127.0.0.1`).

1. **Strava login.** Signed out, open Fitness Profile: you land on Log in. Click "Connect with Strava", approve on Strava, and you come back to myKOM with your avatar and first name in the header. Log out, then connect again: Strava shouldn't ask you to approve a second time, and you're the same Runner (your Fitness Profile is still there). Also try unticking a permission on Strava's approval screen: sign-in still works.
2. **Denying on Strava.** Click "Connect with Strava", then Cancel on Strava: you're back on Log in with a message saying access was denied.
3. **Geolocation prompt.** On Search Area, click "Use my location": the browser asks for permission. Allow it, and the centre becomes "My location"; save and reload to see it restored. Then block location for `localhost` in the browser's site settings and try again: you get the IP fallback (or, locally, the "Couldn’t find your location" message, since a loopback address isn't in GeoLite2).
4. **Place search.** Search for a real postcode, pick a result, choose a radius, save, and reload.
5. **Disconnect.** Click Disconnect: a dialog warns that all your data will be deleted. Cancel leaves everything as it was. Confirm, and you land on Log in with a confirmation message; myKOM no longer appears under "My Apps" at https://www.strava.com/settings/apps, and connecting again starts with an empty Fitness Profile and Search Area.
