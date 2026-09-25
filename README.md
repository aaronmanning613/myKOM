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

| Command            | What it does                                    |
| ------------------ | ----------------------------------------------- |
| `pnpm test`        | Unit tests (Vitest) in every package, see below |
| `pnpm test:e2e`    | End-to-end tests (Playwright), see below        |
| `pnpm typecheck`   | TypeScript checks in every package              |
| `pnpm lint`        | ESLint and Prettier checks                      |
| `pnpm format`      | Format everything with Prettier                 |
| `pnpm build`       | Build every package                             |
| `pnpm db:generate` | Generate a migration from the Drizzle schema    |
| `pnpm db:migrate`  | Apply pending migrations                        |

### Unit tests

`pnpm test` runs Vitest in every package. The API's tests need Postgres running (`docker compose up -d --wait`): they create and migrate a separate `mykom_test` database (or use `TEST_DATABASE_URL`), so they never touch your development data.

### End-to-end tests

`pnpm test:e2e` runs the Playwright tests in `e2e/` against your installed Google Chrome (no browser download). Postgres must be running (`docker compose up -d --wait`); Playwright migrates the database and starts its own API (port 3101) and web app (port 5174), so it doesn't clash with `pnpm dev`.

To stop Postgres, run `docker compose down` (add `-v` to also delete the data).
