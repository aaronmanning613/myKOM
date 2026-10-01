# PRD: the Segment map

## Goal

Add a map to the Results page, and links from every Segment to its page on Strava:

- the map shows the Segments myKOM suggests (Your targets and Nearest misses) inside the Search Area;
- a Segment is drawn as its **full route** when its polyline is stored, and as its **start point** otherwise;
- every Segment links to `https://www.strava.com/segments/<id>` ("View on Strava"), from the map and from the lists.

**The source of truth is this PRD.** There's no separate spec issue for the map. [Spec: myKOM](https://github.com/aaronmanning613/myKOM/issues/27) (`gh issue view 27`) still governs everything else, and tasks name its sections where they touch them (UI → Results page, Strava API Policy stance). This PRD lifts one item from #27's Out of Scope: "A map view". Domain terms are defined in `CONTEXT.md`; use them in code, UI and tests.

The core loop's PRD and progress log are archived in `docs/ralph/core/`, and the foundation loop's in `docs/ralph/foundation/`. Their progress logs record tooling gotchas (pnpm build approvals, ESM `.js` imports, live-test rules, Playwright's substring role-name matching) that still apply.

This work lives on the `feature/segment-map` branch. Never push, merge or switch branches.

## Decisions

These were made up front, so the loop doesn't need to ask. Follow them; anything they don't cover gets the usual `TODO(decision)` treatment.

- **Geometry costs no Strava reads.** A Segment's `map.polyline` already arrives with its Segment details, which every ranked Segment has, and is stored in `segments.polyline`. The map uses only stored data: the polyline when it's stored and decodes to at least 2 points, otherwise the stored start point. Nothing fetches geometry, so a missing polyline is never fetched (no streams, no extra detail calls).
- **What's on the map:** Your targets and Nearest misses. Suspicious records are left off the map, because they aren't suggestions, but they keep their Strava links in the list. The Search Area is drawn as a circle around its centre.
- **Library:** `leaflet` with `react-leaflet` (v5, for React 19), plus `@types/leaflet`. React renders popup content, so Segment names (written by Strava users) are escaped. Never build popup HTML from strings.
- **Tiles:** OpenStreetMap's standard tiles, `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, max zoom 19, with the attribution "© OpenStreetMap contributors" linking to `https://www.openstreetmap.org/copyright`. myKOM's traffic (≤ 10 Runners) is well inside the OSM tile usage policy. There's no API key and no other provider.
- **Markers:** only `CircleMarker`s and `Polyline`s. Leaflet's default `Marker` needs image assets that break under bundlers.
- **Colours:** Your targets are orange (`#ea580c`, the app's orange-600). Nearest misses are blue (`#2563eb`). The Search Area circle is grey, dashed, with no fill. Each route is a 4 px line with a small filled circle at its start. Each start-only Segment is a larger filled circle (radius 7) with a white outline.
- **Placement and size:** the map goes on the Results page between the summary/status lines and Your targets. It's full width and 260 px tall on phones, 400 px from the `sm` breakpoint. A one-line legend sits under it: "● Your targets ● Nearest misses · a line is the whole Segment, a dot is its start".
- **Framing:** the map fits the Search Area circle's bounds on first render, and again whenever the Search Area (centre or radius) changes. It never refits on a results poll, so a Runner's own pan and zoom survive the "refining" updates.
- **Gestures:** scroll-wheel zoom is off, so the page scrolls past the map. On touch devices one-finger dragging is off too (`dragging: !L.Browser.mobile`), so the page still scrolls on phones. Zoom works with the +/− buttons and pinch.
- **Popup** (opened by clicking or tapping a Segment): the name with 👑 when Held, then "Your target" or "Nearest miss", then distance · average grade, then Record / Predicted / Your PB in the list's formats, then a "View on Strava" link. A start-only Segment adds "Start point only".
- **Strava links:** the text is exactly "View on Strava" (Strava's brand guidelines), styled bold and underlined in Strava orange `#FC5200`. Links open in a new tab with `rel="noopener noreferrer"`. The URL comes from one shared helper, `stravaSegmentUrl(id)`. Lists show the link in every row of all three sections, on the Results page and in the wizard's step 3.
- **List → map:** each row in Your targets and Nearest misses on the Results page gets a "Show on map" button. It scrolls the map into view, fits the map to that Segment (its route's bounds, or zoom 16 on its start), and opens its popup. The wizard has no map, so it has no such button.
- **Loading:** the map is a lazily loaded chunk (`React.lazy`), so Leaflet isn't in the main bundle. A placeholder with the same height stands in while it loads, so nothing shifts. The lists never wait for the map.
- **No map** when there are no rows to draw and nothing is pending. The bigger-radius empty state already covers that. While a search is pending with no rows yet, the map shows just the Search Area circle.

## Stack

This is unchanged:

- TypeScript (strict), pnpm workspaces, Node 22;
- `apps/api` is Fastify + Drizzle + Postgres 16 (docker compose, host port 5433);
- `apps/web` is React + Vite + Tailwind + React Router;
- `packages/shared` holds code used by both;
- Vitest, Playwright (`channel: 'chrome'`), ESLint + Prettier.

The new dependencies are `leaflet`, `react-leaflet` and `@types/leaflet`, in `apps/web` only.

## Conventions

The core conventions still apply (see `docs/ralph/core/PRD.md`):

- config comes from `.env` (never read or print it);
- the domain core is pure;
- test at the highest seam that covers the behaviour;
- never store raw Strava JSON;
- never show another athlete's name or photo;
- never call Predicted Time ÷ Target Record a "gap";
- **UI verification:** after UI work, click through with the Playwright MCP browser at desktop and phone width, then make sure an e2e test covers the same flow;
- e2e tests sign in with `POST /api/test/login`.

New conventions:

- **Tests never fetch map tiles.** jsdom doesn't load images. In e2e, a shared Playwright fixture answers every `https://tile.openstreetmap.org/**` request with a bundled 256×256 blank PNG, and every spec uses that fixture. The MCP click-through may load real tiles (a handful of requests, within the usage policy).
- **Leaflet in jsdom:** component tests cover what React renders (the map container, legend, placeholder, buttons, links). The decisions about what to draw live in a pure module with its own unit tests. Real map rendering and clicking on Segments are covered in e2e (real Chrome). Don't mock Leaflet internals to assert on call order.
- **e2e targeting:** every drawn Segment gets the Leaflet `className` `segment-map-<segmentId>`, plus `segment-map-route` or `segment-map-start`, so specs can find and click it.

## Out of scope

- fetching any geometry from Strava (streams, extra detail calls, `/segments/explore`), or refetching Segments whose polyline is missing;
- a map anywhere other than the Results page (not in the wizard, the Search Area page or Mapped Areas);
- marker clustering, heatmaps, elevation profiles, directions or routing, and drawing the Runner's own runs;
- other tile providers, API keys, offline tiles and a satellite layer;
- map → list highlighting (the map's popups carry everything the row does);
- showing Suspicious records on the map;
- remembering the map's pan and zoom across visits, and a hide/show toggle;
- anything that changes ranking, the Strava budget, or the database schema (no migration is needed: `segments.polyline` already exists).

## Tasks

Work top to bottom. Each task's **Check** must pass, plus `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`, before it's ticked.

### Data

- [x] **M1** Geometry and the Strava URL in the results payload:
  - `packages/shared`: `stravaSegmentUrl(id)` returns `https://www.strava.com/segments/<id>`;
  - `ResultRow` gains `start: LatLng` and `polyline: string | null` (the stored encoded polyline, not decoded);
  - `KnownSegment.details` gains `polyline: string | null`, and `apps/api/src/results/load.ts` fills both. `rank` is unchanged apart from passing it through;
  - `POST /api/test/segments` accepts an optional encoded `polyline` per Segment (stored as is) and stores `end_lat/end_lng` from its last point when given;
  - nothing new is fetched from Strava.
  - **Check:**
    - a shared unit test for `stravaSegmentUrl`;
    - seam-3 tests (`app.inject`): `GET /api/results` and `POST /api/search` rows carry `start` and the stored `polyline`, and `null` when none is stored;
    - the fake Strava `fetch` sees no extra calls for geometry (compare the call count with and without polylines stored);
    - `/api/test/segments` stores a given polyline and still rejects unknown fields.

### Lists

- [ ] **M2** "View on Strava" in the lists (spec: UI → Results page):
  - `ResultsSection` rows show a "View on Strava" link under the distance · grade · km line, styled and opening as in Decisions;
  - this covers all three sections on the Results page and the wizard's step 3, which reuses `ResultsSection`;
  - the row's layout and columns stay as they are at phone width (no horizontal overflow at 375 px).
  - **Check:**
    - component tests: each row's link has the right `href`, `target="_blank"`, `rel="noopener noreferrer"` and accessible name (`View <Segment name> on Strava` through `aria-label`, so screen readers can tell the rows apart, while the visible text stays "View on Strava");
    - an e2e test with a seeded area finds a target's link with the Segment's URL.

### Map

- [ ] **M3** What to draw, as a pure module (`apps/web/src/results/segment-map-features.ts`):
  - `segmentMapFeatures(results)` returns the Search Area circle and one feature per row in Your targets and Nearest misses (none for Suspicious records);
  - a feature carries:
    - `segmentId`;
    - `list` (`'targets' | 'nearestMisses'`);
    - `shape`: `{ kind: 'route', points }` when the polyline decodes to ≥ 2 points (using the shared `decodePolyline`), otherwise `{ kind: 'start', point }`;
    - `bounds` (the route's box, or the start point);
    - the row itself, for the popup;
  - a Segment in both lists can't happen, but de-duplicate by `segmentId` anyway, keeping the first;
  - the colours, line weight, radii and tile URL/attribution are named constants exported from this module.
  - **Check:** unit tests for:
    - route vs start (including an empty or 1-point polyline and an undecodable string falling back to the start point);
    - Suspicious rows excluded;
    - the circle matching the Search Area;
    - bounds for a route and for a start point;
    - stable ordering (targets first, then Nearest misses, in list order).

- [ ] **M4** The map on the Results page:
  - add `leaflet`, `react-leaflet` and `@types/leaflet` to `apps/web`, then:
    - `SegmentMap.tsx`, lazily loaded, with a same-height placeholder;
    - Leaflet's CSS imported by the map chunk;
    - OSM tiles and attribution, with gestures, framing (fit on first render and on Search Area change, never on poll), colours, legend and placement as in Decisions;
    - popups as in Decisions, with the "View on Strava" link;
    - each Segment's `className` as in Conventions;
  - check that Tailwind's preflight doesn't distort tiles or the SVG overlay (Leaflet 1.9's CSS sets `max-width: none` on them; add an override only if the click-through shows a problem);
  - add the shared e2e tile fixture (Conventions), and switch every existing spec to it;
  - extend the e2e seeding so a spec can seed a route Segment and a start-only Segment.
  - **Check:**
    - component tests: the placeholder shows, then the map region (`role="region"`, `aria-label="Segment map"`) and the legend; no map with no rows and nothing pending; the circle-only map while pending with no rows;
    - e2e with a seeded area (one route target, one start-only target, one Nearest miss, one Suspicious record):
      - a `segment-map-route` and a `segment-map-start` element render for the targets, and one for the Nearest miss;
      - nothing renders for the Suspicious record;
      - clicking the route opens a popup with the Segment's name and a "View on Strava" link to its URL;
      - the start-only popup says "Start point only";
      - no request leaves for a real tile server (assert through the fixture).

- [ ] **M5** "Show on map" from the list:
  - a "Show on map" button in each Your targets and Nearest misses row on the Results page (not Suspicious records, not the wizard);
  - it scrolls the map into view (`scrollIntoView({ block: 'nearest', behavior: 'smooth' })`), fits the map to that Segment, and opens its popup;
  - the selection is lifted state in `ResultsView`, handed to the map; closing the popup clears it;
  - a poll that drops the selected Segment closes its popup and clears the selection;
  - `ResultsSection` takes an optional `onShowOnMap(segmentId)`, and renders the button only when it's given.
  - **Check:**
    - component tests: the button appears only in the two sections on the Results page and calls back with the row's id; the wizard has no button;
    - an e2e test: click "Show on map" on the start-only target, and its popup opens with "Start point only" and the right link;
    - repeat at a 375 px viewport.

### Wrap-up

- [ ] **M6** Full pass:
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build`. The build output must show Leaflet in a separate chunk from the main entry; record both chunk sizes in progress.txt;
  - a final MCP click-through of the Results page as the real Runner (`pnpm dev:live`), at desktop and 375 px, against the Search Area already saved:
    - don't start a new search or change the radius;
    - opening Results drains queued work, so use at most **10 Strava reads**, checked through the usage counters before and after;
    - real tiles load, routes and start points sit on the right streets, popups and "View on Strava" links work, "Show on map" works, the page scrolls past the map on the phone viewport, and there are no console errors;
  - update the README: a line on the map and its OSM tiles, and the e2e tile fixture.
  - **Check:** everything passes; the click-through finds nothing broken; reads stay within 10.
