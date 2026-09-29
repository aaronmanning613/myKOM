# PRD: myKOM core

## Goal

Build myKOM on top of the merged foundation:

- a Fitness Profile generated from the Runner's Strava runs;
- the Predicted Time model;
- gathering Known Segments within Strava's rate limits;
- ranking into Your targets, Nearest misses and Suspicious records;
- the first-run wizard, the Fitness Profile, Search Area and Results pages, and the suggestion banner;
- everything needed to deploy.

**The source of truth is the spec, [Spec: myKOM](https://github.com/aaronmanning613/myKOM/issues/27)** (`gh issue view 27`). Each task below names the spec section it builds. Read that section before starting, because the task lines are summaries. Where a task and the spec disagree, the spec wins. Domain terms are defined in `CONTEXT.md`; use them in code, UI and tests.

The foundation loop's PRD and progress log are archived in `docs/ralph/foundation/`. Its progress log records tooling gotchas (pnpm build approvals, ESM `.js` imports, live-test rules) that still apply.

## Stack

This is unchanged from the foundation:

- TypeScript (strict), pnpm workspaces, Node 22;
- `apps/api` is Fastify + Drizzle + Postgres 16 (docker compose, host port 5433);
- `apps/web` is React + Vite + Tailwind + React Router;
- `packages/shared` holds code used by both;
- Vitest, Playwright (`channel: 'chrome'`), ESLint + Prettier.

## Conventions

The foundation's conventions still apply:

- Config comes from `.env` (never read or print it). Every variable goes in `.env.example`.
- Tests never hit real external APIs.
- **UI verification:** after UI work, click through with the Playwright MCP browser at desktop and phone width, then make sure an e2e test covers the same flow.
- e2e tests sign in with `POST /api/test/login`.

New conventions:

- **The domain core is pure.** Fitness Profile generation, VDOT, `xoms` parsing, the Predicted Time model, the Implausible check and `rank(...)` live in `packages/shared` with **no I/O** (no DB, fetch, clock or env). The time is passed in. The API and web call them. This is test seam 1.
- **The job queue** (`drain(...)` against Postgres, with a Strava client passed in) is test seam 2. **The HTTP API** (`app.inject`, with a fake Strava at `fetch`) is test seam 3. Test external behaviour at the highest seam that covers it. Don't test private helpers.
- **Tunables:** every constant in the spec's Tunables table is one named, exported constant in a single shared module, with a comment saying whether it's decided or a starting value.
- **Strava fixtures:** faked Strava responses must match the shape of real ones. A task may capture real responses from the live account (`.strava-live-token.json`, through the existing live token store), using **at most 10 Strava calls per task**, and save them as scrubbed fixtures: no tokens, and no other athletes' names or photos (drop `local_legend` and similar). Keep only the fields myKOM reads.
- **Never store raw Strava JSON** in the database. Map responses to our own shapes at the Strava client.
- **Words:** never use "gap" for Predicted Time ÷ Target Record (on Strava, GAP means grade adjusted pace). Call it the **record ratio**. Never show another athlete's name or photo.
- **Migrations:** one drizzle-kit migration per task that changes the schema, applied by `pnpm db:migrate`. Existing data must migrate, not be dropped (except where a task says so).

## Out of scope

- everything in the spec's Out of Scope section;
- webhooks, altitude streams, `/segments/explore`, the leaderboard endpoint, scraping;
- a map view;
- a Runner-set margin;
- the IP fallback in production;
- anything that provisions real cloud resources (see "Human setup" at the end).

## Tasks

Work top to bottom. Each task's **Check** must pass, plus `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`, before it's ticked.

### Domain core (spec: Fitness Profile generation, Predicted Time model, Target Record/Held/Implausible, Ranking, Tunables)

- [x] **C1** Benchmark distances 7 → 13.
  - The shared distance list becomes 400 m, 800 m, 1K, 1 mile, 3K, 5K, 8K, 10K, 15K, 10 mile, half (21,097.5 m), 30K and marathon (42,195 m). ½ mile and 2 mile are dropped.
  - Add a migration that deletes stored Benchmarks for the dropped distances.
  - Update the Fitness Profile screen, the API validation and every test.
  - Also add the tunables module (see Conventions) holding the spec's full Tunables table.
  - **Check:** shared, API and web tests pass with 13 rows; the Fitness Profile e2e test enters and persists a Benchmark at a new distance (e.g. 8K).
- [x] **C2** VDOT in the shared core:
  - `vdotOf(metres, seconds)` and `timeFor(vdot, metres)` (Daniels & Gilbert; the exact formulas are in the spec);
  - `benchmarksFromVdot(vdot)` giving all 13;
  - `updateAllFrom(distance, seconds)`.
  - **Check:** table tests reproduce the spec's numbers: VDOT 71.1 → 5K 14:43, 10K 30:36, marathon 2:21:16; a 16:00 5K → 10K 33:13, half 1:13:19, marathon 2:33:26 (±1 s).
- [x] **C3** `generateFitnessProfile(activities, now)`:
  - use runs only, from the last 3 years;
  - for each distance D, use runs in the 0.98 D–1.06 D band, scale to D by moving time × D ÷ distance, and take the fastest;
  - score them by VDOT and average the best two, but the second only counts if it's within 8 of the best;
  - return `{ vdot, sources: 1–2 runs, benchmarks } | null`.
  - **Check:** table tests cover:
    - the test-account case (marathon 2:21:03 + 10K 30:39 → VDOT ≈ 71.1);
    - one race plus easy runs (the guard drops the easy run);
    - no qualifying runs → null;
    - runs older than 3 years are ignored;
    - moving time is used, not elapsed;
    - a run just outside the band is ignored.
- [x] **C4** Target Record parsing:
  - `parseXoms` accepts `"17s"`, `"1:24"` and `"h:mm:ss"`, and anything else is `unparseable`;
  - `recordFor(segment, gender)` returns seconds, or a status of `hazardous`/`missing`/`unparseable`;
  - `isHeld(pb, record)` counts whole-second ties as Held, and a missing PB is not Held.
  - **Check:** table tests for every format, hazardous, missing gender, garbage strings and ties.
- [x] **C5** The flat Predicted Time model:
  - usable Benchmarks exclude **soft** ones (pace slower than a longer Benchmark's pace), and at least two are needed;
  - log-log interpolation between neighbours;
  - extrapolation past either end uses the two nearest Benchmarks' exponent clamped to 1.02–1.15, and is low confidence;
  - return the soft set so the UI can flag it.
  - **Check:** tests for interpolation exactness at Benchmark points, extrapolation both ends with clamping, soft detection, and < 2 usable → no prediction.
- [x] **C6** Grade and the full `predict(benchmarks, segment, pb)`:
  - equivalent flat distance: uphill uses Minetti `Cr(i)/3.6`; downhill is capped at 0.88 around −9.5%, easing linearly back to 1.0 by −20% (a starting value);
  - rolling penalty (starting values from the spec);
  - PB floor = min(model, PB), only when no Benchmark is pinned;
  - Prediction Confidence with a reason: high when the PB floor set the time; otherwise low when outside the Benchmark range (including < 400 m), when |max grade| > 15%, or when the Segment is rolling; otherwise high.
  - **Check:** tests for flat vs uphill vs downhill ordering, the downhill cap, rolling → low, pinned disables the floor, the floor → high, and the steep → low reason.
- [x] **C7** Implausible Records:
  - a world-record table (men's and women's; 100 m, 200 m, 400 m, 800 m, 1500 m, mile, 3000 m, 5000 m, 10,000 m, half, marathon, as constants with a source comment) is run through `predict` as a Fitness Profile (no PB floor) to get a grade-adjusted world-record time;
  - `isImplausible(record, segment, gender)` is true when record < WR time × 1.05.
  - **Check:** tests: a 160 m / 17 s KOM is **not** flagged (as the spec says); an obviously impossible record (e.g. 1 km in 1:30) is flagged; QOM uses the women's table.
- [x] **C8** `rank(input)`, as sketched in the spec's Ranking section:
  - area membership by the start point's great-circle distance;
  - the exclusion reasons, in order;
  - Your targets = Achievable (≤ record × 1.05) + all Held, minus non-Held Implausible; high confidence first, then Impressiveness desc, record ratio asc, id;
  - Nearest misses when < 5 Achievable: up to 10, by record ratio;
  - Suspicious = non-Held Implausible, by Impressiveness;
  - counts;
  - pending (no details) Segments are left out of the lists.
  - **Check:** table tests for each list rule, Held + Implausible appearing only in the main list, the Nearest-misses threshold at exactly 4 vs 5, tie-breaks, and every exclusion reason.

### Data and Strava (spec: Data model, Background work, Strava API Policy stance)

- [x] **D1** Token encryption:
  - Strava access and refresh tokens are stored AES-256-GCM encrypted, with the key from `TOKEN_ENCRYPTION_KEY` (32 bytes, base64; add it to `.env.example`);
  - it's required when `NODE_ENV=production`; outside production, fall back to a fixed dev key and log a warning;
  - a migration encrypts existing plain-text rows.
  - The live token store file is unchanged.
  - **Check:** inject/DB tests: the stored columns aren't the plain token; sign-in, refresh and disconnect still work; a wrong key fails clearly; the migration test round-trips an existing row.
- [x] **D2** Schema for the core, as in the spec's Data model:
  - `runners` gains `record_gender`, `onboarded_at`, `activities_checked_at` and `resynced_at`;
  - `benchmarks.source` becomes `runner | generated` (migrate the old values), and gains `generated_seconds`;
  - new tables: `fitness_profiles`, `activities`, `segments` (shared, with a start lat/lng bounding-box index), `runner_segments`, `mapped_areas`, `crawls`, `strava_jobs`, `strava_read_usage`, `app_state`;
  - every per-Runner table cascades from `runners`.
  - **Check:** the migration applies to a DB with foundation data; the disconnect test now asserts every per-Runner table is emptied and a shared `segments` row survives.
- [x] **D3** Strava client reads, all through the existing client:
  - `listActivities({ after?, page })`, `getActivity(id)`, `getSegment(id)` and `getStarredSegments(page)`;
  - each maps to our own shapes (activity summary with polyline and bbox; efforts with the embedded summary Segment, achievements and `kom_rank`; Segment detail with `xoms`, `athlete_count`, `hazardous`, geometry and `athlete_segment_stats`), with no raw JSON kept;
  - parse the `x-ratelimit-*` / `x-readratelimit-*` headers into every result;
  - typed errors for 429 (with retry timing) and **revoked** (`invalid_grant` on refresh, or 401).
  - Capture fixtures as described in Conventions.
  - **Check:** client tests with mocked `fetch` over the fixtures, including header parsing, 429 and revoked; a `.live.test.ts` for `getSegment` + `listActivities` (≤ 3 calls) in `pnpm test:live`.
- [x] **D4** Revocation cascade: a revoked token error during any Strava call made for a Runner runs the same deletion as Disconnect and ends their session, so the next request is a 401 and the web app shows the login page.
  - **Check:** an inject test where the fake Strava rejects the refresh with `invalid_grant`: the Runner's rows are gone and `/api/me` is 401.

### Job queue (spec: Background work and the Strava budget)

- [x] **J1** Queue core:
  - enqueue with kind, target, Runner, crawl and priority (search > new-run > mapping > freshness), with de-duplication of identical pending jobs;
  - `drain({ deadline, now, strava })` claims with `FOR UPDATE SKIP LOCKED`, runs handlers by kind, and records success, retry (attempts, backoff via `not_before`) or failure;
  - handlers are registered by kind.
  - **Check:** seam-2 tests against Postgres: priority order; `not_before` respected; two concurrent drains never run the same job; the deadline stops the drain; retries give up after the attempt limit.
- [x] **J2** Budget:
  - `strava_read_usage` keeps app-wide 15-minute window and day counters (synced from the rate-limit headers) and per-Runner daily reads;
  - drains stop before using the last 10 reads of a window, which stay reserved for interactive calls;
  - a Runner at 500 reads today has their jobs deferred to the next UTC day;
  - a 429 defers to the next window.
  - Expose `budgetStatus(runnerId)` for the "continues tomorrow" message.
  - **Check:** seam-2 tests for each rule with a fake clock.
- [x] **J3** Handlers:
  - **activity detail:** upsert summary-only `segments` rows; update `runner_segments` (via run, effort count, best time/date, top-10 hint); an effort with a KOM/QOM achievement or top-10 hint enqueues that Segment's detail at **search** priority; mark `detail_fetched_at`;
  - **Segment detail:** fill the shared `segments` row, `record_status` (with a log line for `unparseable`, including the raw string), `athlete_count` and geometry; take the PB from `athlete_segment_stats` when faster;
  - **starred:** upsert `runner_segments` via starred.
  - **Check:** seam-2 tests with fixture responses for each handler, including "I just took it" and a starred-never-run Segment.
- [x] **J4** Crawls (spec: Known Segment gathering):
  - for a centre + radius, select the Runner's stored activities whose polyline passes through the area (bbox prefilter, then decoded polyline);
  - order greedily by new ground (about 100 m grid cells), newest first on ties;
  - enqueue run details progressively;
  - stop at 95% coverage, or when the last 10 runs added < 3 new Segments;
  - enqueue missing Segment details in the spec's order (top-10/KOM hints, then most run, then nearest the centre);
  - track progress ("N of ~M") and status on `crawls`.
  - A Mapped Area crawl runs at mapping priority to 100% coverage.
  - **Check:** seam-2 tests with synthetic polylines for selection, greedy ordering, both stop rules, detail ordering and progress counts.
- [x] **J5** Tick and housekeeping:
  - `POST /internal/tick` runs a time-capped drain (about 20 s) and, once a day (tracked in `app_state`), housekeeping: enqueue freshness re-fetches for Segment details older than 30 days, oldest first, recently searched areas first; prune finished jobs and old usage rows;
  - the route verifies a Google OIDC token (the audience is the service URL, the issuer is Google, and the email is the configured Scheduler service account, from new env vars in `.env.example`);
  - outside production, the dev server also calls the same function on a 5-minute `setInterval`, and test mode can call it without a token.
  - **Check:** inject tests: missing/invalid/wrong-audience tokens are rejected (sign test tokens with a local key via a JWKS stub); housekeeping runs once per day; freshness picks the right Segments.

### New runs and the Fitness Profile (spec: Fitness Profile generation, New activities)

- [x] **N1** Activity sync:
  - `syncActivities(runner, mode)`, where `full` pages through the whole activity list, upserts runs, deletes the Runner's stored runs that no longer exist and recomputes the affected `runner_segments` bests, and `new` fetches `after=<latest stored start>`;
  - both are interactive calls (they use the reserve);
  - on first sign-in, run `full` plus the starred Segments fetch.
  - **Check:** seam-3 tests with a fake Strava: first sign-in stores the runs; `new` fetches only after the latest; `full` removes a deleted run and its effort contribution.
- [x] **N2** Profile persistence and endpoints:
  - after a sync, generate (C3) and store the applied generation in `fitness_profiles`, setting unpinned Benchmarks to generated values and keeping `generated_seconds` on pinned ones;
  - `GET /api/fitness-profile` returns each Benchmark with value, source, generated value and soft flag, plus the "Estimated from …" source runs and any pending suggestion;
  - `PUT` pins edited rows and unpins "use generated" ones;
  - `POST /api/fitness-profile/update-all`, `/reset` and `/regenerate` (runs a `new` sync, ignoring the throttle, and applies directly);
  - `PUT /api/preferences` sets KOM/QOM.
  - **Check:** seam-3 tests for each endpoint, including pins surviving regeneration, update-all overwriting pins, and reset.
- [x] **N3** The visit check and suggestions:
  - on the first authenticated request when `activities_checked_at` is older than 3 hours, run a `new` sync;
  - queue each new run's detail at new-run priority; queue Segment details for new Segments that start inside a saved Search Area or Mapped Area at mapping priority;
  - regenerate the profile, and if the unpinned values differ from the applied ones and from the last dismissed values, store a pending suggestion;
  - `POST /api/fitness-profile/suggestion` with `{ action: 'apply' | 'dismiss' }`;
  - `POST /api/activities/resync` runs a `full` sync, sets `resynced_at`, then does the same;
  - `GET /api/me` gains `onboarded` and `suggestion` (a summary for the banner).
  - **Check:** seam-3 tests: throttle respected; new-run jobs queued; suggestion created, applied, dismissed, not re-shown for the same values, re-shown for new ones; pinned untouched; resync reconciles.

### Search and results API (spec: Ranking, Known Segment gathering, API)

- [x] **X1** Search:
  - Search Area radii become 1, 2, 5, 10 km (default 5);
  - `POST /api/search` replaces `PUT /api/search-area`: it saves the area, sets `onboarded_at` if unset, fetches starred Segments, starts a crawl (J4), drains a first burst (about 20 runs + 60 Segment details, 8 in parallel, within the budget), and returns the results payload;
  - `GET /api/search-area` is unchanged.
  - **Check:** seam-3 tests with a fake Strava: the first call returns stored Segments immediately plus progress; the burst respects the budget; an invalid radius is rejected.
- [x] **X2** Results:
  - `GET /api/results` loads the area's Known Segments with SQL (bbox index + exact distance, zero Strava calls), the Benchmarks and gender, and calls `rank`;
  - it returns the three lists (rows carry name, distance, avg grade, km from centre, athletes, record, Predicted Time + confidence reason, PB, Held, Implausible, record age), counts, crawl progress and `budgetStatus`;
  - while work is pending, it drains for up to about 2 s first.
  - `GET /api/debug/segments` (outside production only) returns the same pipeline's per-Segment exclusion reasons.
  - **Check:** seam-3 tests: lists match `rank` for a seeded area; a poll advances progress; "continues tomorrow" appears at the cap; the debug output agrees with the results for every Segment; one Runner never sees another's PBs.
- [x] **X3** Mapped Areas: `GET/POST/DELETE /api/mapped-areas` (label, centre, radius 10/25/50, default 25), with a mapping-priority crawl and progress in the list. Delete stops its pending jobs.
  - **Check:** seam-3 tests for create, list with progress, delete cancelling jobs, and scoping to the signed-in Runner.

### UI (spec: UI; decided prototypes on branches `prototype/results-list` and `prototype/onboarding`, variant A)

- [x] **U1** The Fitness Profile page, rebuilt on N2:
  - the "Estimated from …" sentence;
  - the 13-row table with editable times, pinned state (orange, "📌 yours · generated X · use generated") and soft flag;
  - **Update all from this** on the row just edited, with its confirmation;
  - **Reset all to generated** when anything is pinned;
  - **Regenerate from Strava**;
  - **Resync my runs**, with its explainer and last-resynced time;
  - the empty-profile message.
  - **Check:** component tests plus e2e: edit → pinned → reload persists; update-all; reset; use generated.
- [x] **U2** The suggestion banner:
  - a slim banner under the nav on every signed-in page while `/api/me` reports a suggestion;
  - **Apply** in place, **Review** (opens the Fitness Profile with suggested values beside current ones), **×** dismiss.
  - **Check:** component tests plus e2e for apply and dismiss (seed a suggestion through a test-only route or DB helper).
- [x] **U3** The Search Area page:
  - radii 1/2/5/10 (10 marked "slower, uses more of the daily budget");
  - saving calls `POST /api/search` and goes to Results;
  - the IP fallback is hidden when the server reports it unavailable, as it always is in production (config);
  - a "Map a whole area in the background" section: place + radius 10/25/50 (default 25), and a list of Mapped Areas with progress bars and remove buttons.
  - **Check:** component tests plus e2e for search → results, and start/remove a Mapped Area.
- [x] **U4** The Results page, replacing the prototype and the placeholder:
  - a toolbar with a radius dropdown (re-runs the search) and the place linking to the Search Area page;
  - the summary line "N of M Known Segments are Achievable";
  - Your targets / Nearest misses / Suspicious records (muted) with counts;
  - rows as in the spec (👑, "⚠ Suspicious", `~` with the reason on hover, "—" for no PB, record age when > 30 days);
  - a "refining: N of ~M Segments checked" line polling every 5 s while pending, stopping when done;
  - "continues tomorrow" at the cap;
  - an empty state suggesting a bigger radius;
  - with < 2 Benchmarks, a prompt linking to the Fitness Profile.
  - Delete the results prototype files and route.
  - **Check:** component tests over fixture payloads (including a slow Runner with Nearest misses) plus e2e with a seeded area.
- [x] **U5** The first-run wizard and routing:
  - a three-step wizard with a step bar;
  - step 1: reading runs, the sentence, the table, and a KOM/QOM question only when `sex` is unset; continue is disabled until ≥ 2 Benchmarks exist;
  - step 2: the Search Area form + **Find my targets**;
  - step 3: crawl progress "N of ~M runs checked · K Segments found. You can leave; this keeps going.", targets appearing live, and **See all results**;
  - after login, Runners who aren't onboarded go to the wizard (resuming there if they left during step 1), and others land on Results.
  - Delete the onboarding prototype files and route, and the prototype switcher if it's then unused.
  - **Check:** component tests plus e2e: a new Runner walks all three steps; leaving at step 1 resumes; the KOM/QOM question appears only without `sex`; an onboarded Runner lands on Results.

### Production build (spec: Hosting and deployment). Code only; no cloud resources

- [ ] **H1** One production image:
  - the API serves the built web app with `@fastify/static` (SPA fallback for client routes, `/api` and `/internal` excluded);
  - production config requires the spec's secrets, and disables test, live and debug routes and the IP fallback;
  - a multi-stage `Dockerfile` (the build stage runs `pnpm build`; the runtime is Node 22 slim) that listens on `$PORT`.
  - **Check:** `docker build` succeeds; running the image against the local Postgres with production env serves the web app at `/`, `/api/health` is ok, and `/api/test/login` is 404.
- [ ] **H2** Deploy workflow and docs:
  - a GitHub Actions workflow on push to `main`: install, typecheck/lint/test, `drizzle-kit migrate` against `DATABASE_URL`, build and push the image to Artifact Registry in `northamerica-northeast1`, and `gcloud run deploy` (max 1 instance, min 0, concurrency 80, secrets from Secret Manager), authenticating with Workload Identity Federation;
  - `docs/deploy.md` records the one-time human setup (below) as an exact checklist, including the Scheduler job and the $1 budget alert.
  - **Check:** the workflow YAML parses (use `actionlint` if available, otherwise a YAML parse) and references only secrets and variables listed in `docs/deploy.md`.

### Wrap-up

- [ ] **W1** Full pass:
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build`;
  - add a live smoke test to `pnpm test:e2e:live`: a real 1 km search on the test account returns ranked rows, capped at **30 Strava reads** (assert it through the usage counters);
  - a final MCP click-through of every page as the real Runner (`pnpm dev:live`);
  - update the README (new env vars, the tick in dev, the debug endpoint).
  - **Check:** everything passes, and the live smoke test stays within its read cap.

## Human setup (not loop tasks)

The loop never does these, because they need your accounts. Do them after H2, following `docs/deploy.md`:

- **Strava:** the self-service upgrade to 10 athletes; add the `*.run.app` domain as a callback domain once it exists.
- **GCP:**
  - create the project and turn on the budget alert at $1;
  - set up Artifact Registry and Cloud Run (Montréal);
  - add the Secret Manager secrets (`DATABASE_URL`, `SESSION_SECRET`, `STRAVA_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY`);
  - create the Scheduler service account and the 5-minute Cloud Scheduler job with an OIDC token;
  - connect GitHub through Workload Identity Federation.
- **Supabase:** a Free project in `ca-central-1`, and the IPv4 session-pooler URL for `DATABASE_URL`.
- **GitHub:** the WIF variables and the `DATABASE_URL` secret.
