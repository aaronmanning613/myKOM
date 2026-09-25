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

   The other variables have working defaults for local development.

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

| Command            | What it does                                 |
| ------------------ | -------------------------------------------- |
| `pnpm test`        | Unit tests (Vitest) in every package         |
| `pnpm typecheck`   | TypeScript checks in every package           |
| `pnpm lint`        | ESLint and Prettier checks                   |
| `pnpm format`      | Format everything with Prettier              |
| `pnpm build`       | Build every package                          |
| `pnpm db:generate` | Generate a migration from the Drizzle schema |
| `pnpm db:migrate`  | Apply pending migrations                     |

To stop Postgres, run `docker compose down` (add `-v` to also delete the data).
