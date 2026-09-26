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

   For place and postcode search, also set `NOMINATIM_USER_AGENT` to something that names the app and gives your contact, e.g. `myKOM/0.1 (you@example.com)`: [Nominatim's usage policy](https://operations.osmfoundation.org/policies/nominatim/) requires it. Without it, place search replies 503. The API calls Nominatim at most once a second and caches every search in the `geocode_cache` table.

   For the IP-location fallback behind "Use my location" (optional), see [IP location](#ip-location) below.

   The other variables have working defaults for local development. To sign in with Strava, open the web app at `http://localhost:5173` (not `127.0.0.1`), since that's the callback domain Strava accepts.

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

| Command                | What it does                                    |
| ---------------------- | ----------------------------------------------- |
| `pnpm test`            | Unit tests (Vitest) in every package, see below |
| `pnpm test:e2e`        | End-to-end tests (Playwright), see below        |
| `pnpm typecheck`       | TypeScript checks in every package              |
| `pnpm lint`            | ESLint and Prettier checks                      |
| `pnpm format`          | Format everything with Prettier                 |
| `pnpm build`           | Build every package                             |
| `pnpm db:generate`     | Generate a migration from the Drizzle schema    |
| `pnpm db:migrate`      | Apply pending migrations                        |
| `pnpm geolite2:update` | Download the GeoLite2 City database, see below  |

`packages/shared` holds code both apps use. In development, tests and typechecks it is used straight from its TypeScript source; `pnpm build` also compiles it to `dist/`, which the built API loads through the `mykom-dist` export condition (`pnpm --dir apps/api start`).

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

To stop Postgres, run `docker compose down` (add `-v` to also delete the data).

### Manual checks

The automated tests never touch real Strava, real browser location prompts or real Nominatim, so check these by hand before a release. Run `pnpm dev` (without `E2E=1`), with your Strava credentials and `NOMINATIM_USER_AGENT` in `.env`, and open http://localhost:5173 (not `127.0.0.1`).

1. **Strava login.** Signed out, open Fitness Profile: you land on Log in. Click "Connect with Strava", approve on Strava, and you come back to myKOM with your avatar and first name in the header. Log out, then connect again: Strava shouldn't ask you to approve a second time, and you're the same Runner (your Fitness Profile is still there). Also try unticking a permission on Strava's approval screen: sign-in still works.
2. **Denying on Strava.** Click "Connect with Strava", then Cancel on Strava: you're back on Log in with a message saying access was denied.
3. **Geolocation prompt.** On Search Area, click "Use my location": the browser asks for permission. Allow it, and the centre becomes "My location"; save and reload to see it restored. Then block location for `localhost` in the browser's site settings and try again: you get the IP fallback (or, locally, the "Couldn’t find your location" message, since a loopback address isn't in GeoLite2).
4. **Place search.** Search for a real postcode, pick a result, choose a radius, save, and reload.
5. **Disconnect.** Click Disconnect: a dialog warns that all your data will be deleted. Cancel leaves everything as it was. Confirm, and you land on Log in with a confirmation message; myKOM no longer appears under "My Apps" at https://www.strava.com/settings/apps, and connecting again starts with an empty Fitness Profile and Search Area.
