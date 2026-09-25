# PRD: myKOM foundation

## Goal

Build the foundation of myKOM: a working monorepo with a Node API and React web app, Strava login, a Fitness Profile screen where the Runner enters Benchmarks, and a Search Area input. This is the decision-independent groundwork from the wayfinder map ([#1](https://github.com/aaronmanning613/myKOM/issues/1)). The product features that rank Segments come later, once the map's open tickets are decided. Domain terms are defined in `CONTEXT.md`; use them in code and UI.

Source issues: [#14 Scaffold the monorepo](https://github.com/aaronmanning613/myKOM/issues/14), [#18 App shell and navigation](https://github.com/aaronmanning613/myKOM/issues/18), [#15 Strava OAuth login](https://github.com/aaronmanning613/myKOM/issues/15), [#16 Fitness Profile screen](https://github.com/aaronmanning613/myKOM/issues/16), [#17 Search Area input](https://github.com/aaronmanning613/myKOM/issues/17). Read the relevant issue with `gh issue view <n>` when a task needs more detail.

## Stack

- TypeScript (strict) everywhere, pnpm workspaces (via corepack), Node 22 (`.nvmrc`).
- `apps/api`: Node + Fastify.
- `apps/web`: React + Vite + Tailwind + React Router.
- `packages/shared`: code used by both apps.
- Drizzle ORM + drizzle-kit migrations; Postgres 16 in `docker-compose.yml` on **host port 5433**.
- Vitest in every package (Testing Library for web); Playwright (`@playwright/test`) for end-to-end tests, using the installed Google Chrome (`channel: 'chrome'`, no browser download); ESLint (flat config) + Prettier.

## Conventions

- Config comes from the repo-root `.env` (git-ignored; already holds `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`). Every variable the app reads is listed, without values, in a committed `.env.example`. Never read, print or commit `.env`.
- The web dev server proxies `/api` to the API.
- Strava's callback domain is registered as `localhost`; any port works.
- Tests never hit real external APIs: mock `fetch` for Strava and Nominatim.
- Keep the DB schema limited to what each task needs.
- **UI verification.** For every task that touches UI, before ticking it: (1) start `pnpm dev` in the background, (2) use the Playwright MCP browser tools (`mcp__playwright__*`) to open the app and click through what you built like a user would, checking the page actually renders, reacts and shows no console errors, and at phone width too, (3) fix anything broken, (4) stop the dev server. Then make sure the task's end-to-end test covers the same flow, so later iterations can't silently break it.
- **Signing in during e2e tests.** Never use real Strava credentials. From A3 onwards, e2e tests sign in through a test-only route (e.g. `POST /api/test/login` that creates a Runner and sets the session cookie), registered only when `NODE_ENV=test` or an `E2E=1` flag is set, never in production.

## Out of scope

Anything the wayfinder map still has open: importing Strava history or best efforts, fetching or caching Known Segments, Predicted Time, ranking, the results list, Strava webhooks, a map view, hosting/deployment. If a task seems to need one of these, stop at the simplest placeholder and leave a `// TODO(decision):` comment.

## Tasks

Work top to bottom. Each task's **Check** must pass, along with `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm test:e2e` once E1 is done), before it is ticked.

### Scaffold (#14)

- [x] **F1** Root workspace: `.nvmrc` (`22`), root `package.json` (`packageManager` pnpm via corepack, `engines.node` `>=22`), `pnpm-workspace.yaml`, `tsconfig.base.json`, ESLint flat config, Prettier config and ignore file, and root scripts `dev`, `build`, `test`, `lint`, `typecheck`, `db:generate`, `db:migrate` (scripts may be stubs until their packages exist). **Check:** `pnpm install && pnpm lint` passes.
- [x] **F2** `apps/api`: Fastify app built by a factory function (so tests can use `app.inject`), env loading from the repo-root `.env`, and `GET /api/health` returning `{ ok: true }`. **Check:** a Vitest test passes, and `curl localhost:<api port>/api/health` works against the running server.
- [x] **F3** `docker-compose.yml` (Postgres 16, host port 5433, named volume), Drizzle config, a DB client module, an initial migration, and `.env.example`. `/api/health` now also reports whether the DB is reachable. **Check:** `docker compose up -d && pnpm db:migrate` succeeds, and health reports the DB as up.
- [x] **F4** `apps/web`: Vite + React + TypeScript + Tailwind, Vitest + Testing Library, and the `/api` proxy. The home page fetches and shows the health status. **Check:** the web test passes and the web app builds.
- [x] **F5** Root `pnpm dev` runs the API and web together, and `README.md` gets local run instructions (prerequisites, `.env` setup, Docker, migrate, dev). **Check:** start `pnpm dev`, curl both ports, then stop it.
- [x] **E1** End-to-end testing: `@playwright/test` in an `e2e/` workspace package with a config that uses `channel: 'chrome'` and starts the API and web servers itself (`webServer`), a root `pnpm test:e2e` script, and a first test that the home page shows the health status. Keep `pnpm test` for unit tests only. **Check:** `pnpm test:e2e` passes, and the UI verification convention is followed (click through the home page with the Playwright MCP browser).

### App shell (#18)

- [x] **S1** React Router layout with a header and nav, and routes `/login`, `/fitness-profile`, `/search-area`, and `/results` (a "coming soon" placeholder: the results list waits on the ranking decisions). Responsive down to phone width, plain Tailwind, no component library. **Check:** a unit test renders each route, and an e2e test navigates between every route via the nav at desktop and phone widths.

### Strava OAuth (#15)

- [x] **A1** Drizzle schema and migration for `runners` (Strava athlete id unique, first name, sex nullable, avatar URL, subscriber flag, timestamps) and `strava_tokens` (runner FK with cascade delete, access token, refresh token, expires_at, granted scopes). **Check:** the migration applies to the local DB.
- [ ] **A2** A Strava client module, the single place every Strava call goes through: build the authorize URL (scopes `read,read_all,activity:read_all,profile:read_all`, `approval_prompt=auto`, a `state` value), exchange a code for tokens, `getValidAccessToken(runnerId)` that refreshes when the token expires within 5 minutes and saves the new one, and `deauthorize(accessToken)`. **Check:** unit tests with mocked `fetch` cover exchange, refresh-when-expiring, no-refresh-when-fresh, and error handling.
- [ ] **A3** Auth routes: `GET /api/auth/strava` redirects to Strava with a signed, short-lived CSRF state cookie; `GET /api/auth/strava/callback` checks the state, exchanges the code, upserts the Runner and tokens, and records the scopes actually granted (Runners can untick them); an httpOnly signed session cookie; `GET /api/me` (401 when signed out); `POST /api/auth/logout`. **Check:** inject tests for the redirect, a callback with mocked Strava, a bad state, `/api/me` and logout.
- [ ] **A4** `POST /api/auth/disconnect`: call Strava deauthorize, then delete all of the Runner's data (Strava's API Policy requires deletion on disconnect) and clear the session. **Check:** a test asserts the Runner's rows are gone.
- [ ] **A5** Web: a login page with a "Connect with Strava" button (follow Strava's brand guidelines), an auth guard that sends signed-out users to `/login`, and a header showing the Runner's avatar and name with Log out and Disconnect (Disconnect asks for confirmation and says data will be deleted). **Check:** component tests with a mocked `/api/me` for the signed-in and signed-out states. Add the test-only sign-in route (see Conventions); e2e tests cover: signed-out redirect to `/login`, the Connect button pointing at `/api/auth/strava`, signed-in header, log out, and disconnect with confirmation.

### Fitness Profile (#16)

- [ ] **P1** In `packages/shared`: the Benchmark distance list (400m, 1/2 mile, 1K, 1 mile, 2 mile, 5K, 10K; defined once so it can change), time parsing and formatting (`ss`, `m:ss`, `h:mm:ss`, rejecting bad input), and pace per km. **Check:** unit tests including edge cases (seconds ≥ 60 in `m:ss`, empty strings, leading zeros).
- [ ] **P2** A `benchmarks` table (runner FK with cascade delete, distance, seconds, `source` enum `runner | strava`, updated_at; one row per runner per distance) and `GET /api/fitness-profile` / `PUT /api/fitness-profile`, scoped to the signed-in Runner. Everything is `source: runner` for now; the Strava import comes later. **Check:** inject tests, including that one Runner can't read or change another's Benchmarks.
- [ ] **P3** The Fitness Profile screen: one row per Benchmark distance with a time input, pace shown, inline validation errors, clear and save. **Check:** a component test covering edit, invalid input and save, and an e2e test that enters Benchmarks, reloads, and sees them persisted.

### Search Area (#17)

- [ ] **L1** Radius options in one config (5, 10, 25, 50 km, a placeholder set) and a `search_areas` table (runner FK with cascade delete, label, lat, lng, radius_km; one per runner) with `GET /api/search-area` / `PUT /api/search-area`. **Check:** inject tests, including an invalid radius being rejected.
- [ ] **L2** A Nominatim client and `GET /api/geocode?q=`: server-side only, throttled to at most 1 request per second across the whole app, a User-Agent naming the app plus a contact taken from `.env` (`NOMINATIM_USER_AGENT`), results cached in a `geocode_cache` table, search on submit only (no autocomplete). Map results to `{ label, lat, lng }`. **Check:** tests for the throttle, a cache hit that skips `fetch`, and result mapping.
- [ ] **L3** IP fallback: `GET /api/locate-ip` using `@maxmind/geoip2-node` and a GeoLite2 City DB whose path comes from `.env`. It uses the real client IP (Fastify `trustProxy` configurable from `.env`) and returns `{ available: false }` when the DB file is missing, without crashing at startup. Add a `scripts/update-geolite2` script driven by `MAXMIND_LICENSE_KEY` and document the setup in the README. **Check:** a test for the missing-DB path and one with the reader mocked.
- [ ] **L4** The Search Area screen: search a place or postcode on submit and pick from the results; "Use my location" through browser geolocation with a finite timeout, falling back to the IP lookup with an "Is this right?" confirmation, because IP location is coarse; a radius picker; save, and restore the saved area on the next visit; OpenStreetMap attribution. **Check:** component tests with mocked geolocation and `fetch` covering search, geolocation success, and fallback. E2e tests (with Nominatim mocked via Playwright route interception or a test stub, and browser geolocation granted/denied via Playwright permissions) cover: postcode search and pick, use-my-location, the IP fallback confirmation, and the saved area restoring after reload.

### Wrap-up

- [ ] **W1** A full pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build`, plus one final click-through of every screen with the Playwright MCP browser. Run the README instructions from a clean `docker compose down -v` to make sure they work, and add a "Manual checks" section to the README (real Strava login click-through, the geolocation prompt, Disconnect). **Check:** all commands succeed from a clean database.
