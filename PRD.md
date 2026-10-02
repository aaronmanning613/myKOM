# PRD: map polish and the Search Area map

## Goal

The Segment map on the Results page is busy, because it draws every Segment in every list. Its routes are also just coloured lines, with no clear start, finish or direction. This loop fixes both, then adds a map to the Search Area page:

- **Paged lists:** each results list shows its top 20 Segments, in ranked order, with a "Show more" button for the next 20;
- **Map follows the lists:** the Segment map draws only the Segments the lists are showing;
- **Start and finish:** every route gets a distinct start marker, a distinct finish marker and a direction arrow;
- **Search Area map:** the Search Area page gets an interactive map. The Runner can tap or click to drop the centre pin, and drag it to fine-tune. Searching a place or postcode, or using "Use my location", moves the pin. The radius is drawn around the pin.

**The source of truth is this PRD.** There's no separate spec issue. [Spec: myKOM](https://github.com/aaronmanning613/myKOM/issues/27) (`gh issue view 27`) still governs everything else, and tasks name its sections where they touch them (UI → Results page, UI → Search Area). This PRD lifts one item from the Segment map PRD's Out of scope: "a map anywhere other than the Results page", for the Search Area page only. Domain terms are defined in `CONTEXT.md`; use them in code, UI and tests.

Earlier loops are archived in `docs/ralph/`:

- `segment-map/` is the Segment map loop that built the current map. Read its Decisions and progress log first, because this loop builds directly on them;
- `core/` and `foundation/` are the loops before it.

Their progress logs record tooling gotchas that still apply: pnpm build approvals, ESM `.js` imports, live-test rules, Playwright's substring role-name matching, Leaflet popups fading out, and Fastify's `removeAdditional`.

This work continues on the `feature/segment-map` branch. Never push, merge or switch branches.

## Decisions

These were made up front, so the loop doesn't need to ask. Follow them; anything they don't cover gets the usual `TODO(decision)` treatment.

### Paged lists

- **Page size:** `RESULTS_PAGE_SIZE = 20`, a named constant in `apps/web` (not a shared tunable, because ranking doesn't use it). Each list starts showing its first 20 rows, in the order the API ranked them. Paging is purely client-side: the API still returns every row, and nothing about `GET /api/results`, `POST /api/search` or ranking changes.
- **Which lists:** Your targets, Nearest misses and Suspicious records each page independently, on the Results page and in the wizard's step 3. Nearest misses is capped at 10 (`MAX_NEAREST_MISSES`), so in practice it never shows the button, but it uses the same code path.
- **Show more:** below a list with hidden rows sits a line "Showing 20 of 47" and a button "Show 20 more", or "Show 7 more" when fewer remain. Clicking it reveals the next page (up to 20). Once every row is shown, the line and button go. There's no "Show fewer" and no "Show all".
- **Heading count:** the section heading keeps its total, "Your targets (47)", not the number shown.
- **Focus:** clicking "Show more" leaves focus on the button. Its new position, below the added rows, is fine. Each button's accessible name says which list it belongs to (`aria-label="Show 20 more Your targets"` and so on), so the buttons can be told apart.
- **State:** how many rows each list shows is lifted state in `ResultsView` (and local state in the wizard's step 3).
  - A results poll **never resets it**, so a Runner's "Show more" survives refining. If a poll shrinks a list below its shown count, all its rows show, and the count is kept for when it grows back.
  - A Search Area change (a new centre or radius, including the Results page's radius select) **resets every list to 20**.

### Map follows the lists

- **What's drawn:** the Segment map draws only the rows currently shown in Your targets and Nearest misses. Suspicious records stay off the map, as before.
- **The seam:** `ResultsView` builds the visible slice (`targets.slice(0, shown.targets)`, the same for Nearest misses) and hands it to `SegmentMapPanel`, which draws it unchanged. `segmentMapFeatures` keeps taking `Pick<Results, 'searchArea' | 'targets' | 'nearestMisses'>`, so it doesn't learn about paging.
- **Framing:** "Show more" adds its Segments to the map without refitting it (the framing rule from the Segment map PRD is unchanged: fit on the Search Area, never on a poll, and now never on "Show more" either).
- **Show on map:** "Show on map" only exists on visible rows, so its Segment is always drawn. The rule that a poll dropping the selected Segment clears the selection now checks the visible rows. A poll that pushes the selected Segment past the shown count clears it too.
- **Empty map:** the "no map when there's nothing to draw and nothing pending" rule is unchanged. It looks at the full lists, and with any rows the first page is never empty.

### Start and finish

- **Route markers**, drawn on every route Segment, in this z-order (bottom to top): the line, the direction arrow, the finish, the start.
  - **Start:** a filled green circle (`START_COLOUR = '#16a34a'`, green-600), radius 6, with a 2 px white outline. It replaces the current small dot in the list colour.
  - **Finish:** a filled near-black circle (`FINISH_COLOUR = '#111827'`, gray-900), radius 6, with a 2 px white outline.
  - **Direction arrow:** one chevron in the list colour with a white outline, placed at the route's halfway point by distance and rotated to the route's bearing there. It's a Leaflet `Marker` with an `L.divIcon` built from static SVG markup (no Segment data in the markup), 16×16 px, and `interactive: false`.
  - **Loops:** when the start and finish are within 25 m of each other (`LOOP_THRESHOLD_METRES`), the finish is drawn as a ring instead: radius 9, no fill, a 3 px near-black outline. The green start then sits inside it, so both stay visible.
- **Start-only Segments** are unchanged: a list-coloured circle, radius 7, with a white outline, and "Start point only" in the popup. There's no finish or arrow, because nothing is known about where they end.
- **Clicking:** the start and finish markers belong to the Segment's `FeatureGroup`, so clicking them opens its popup like clicking the line does. The arrow isn't interactive.
- **Popup:** add one line under distance · grade for routes: "Starts at the green dot, finishes at the black one". There's no extra line for start-only Segments.
- **Legend:** the line under the map becomes "● Your targets ● Nearest misses · ● start ● finish · a dot alone is a Segment's start only". Each dot is coloured as its marker is, and the dots are `aria-hidden`.
- **Markers:** this lifts the Segment map PRD's "only `CircleMarker`s and `Polyline`s" rule, for `L.divIcon` markers only. Leaflet's default image `Marker` icon is still never used, because its image assets break under bundlers. Every `Marker` gets an explicit `divIcon`.
- **e2e class names:** the start dot changes from `segment-map-route-start` to `segment-map-start-marker`. The finish is `segment-map-finish` and the arrow `segment-map-arrow`. Each also carries `segment-map-<segmentId>`.

### The Search Area map

- **Where:** on the Search Area page only (not in the wizard's "Where you run" step, and not in Mapped Areas). `SearchAreaForm` takes an optional `withMap` prop, and only `SearchAreaPage` passes it. The map sits in the Centre section, below the place search and "Use my location", above the Radius fieldset. It has the same full width and height as the Segment map (`260 px` on phones, `400 px` from `sm`).
- **Loading:** it's its own lazily loaded chunk (`search-area/SearchAreaMap.tsx`), with a same-height placeholder ("Loading the map…"), like `SegmentMapPanel`. The form never waits for it, and every way of choosing a centre keeps working while it loads, or if it fails to load.
- **What's drawn:**
  - with a centre: an orange pin at the centre (an `L.divIcon` teardrop in `#ea580c`, 28×40 px, anchored at its tip), and the Search Area circle at the chosen radius. The circle uses the Segment map's style: grey, dashed, no fill, not interactive;
  - with no centre yet (a Runner with no saved Search Area): no pin or circle, and the map shows the whole world at zoom 2, centred on `[20, 0]`.
- **Choosing a centre on the map:**
  - **Drop:** clicking or tapping the map (Leaflet's `click`, which doesn't fire after a drag) moves the pin there and makes it the centre.
  - **Drag:** the pin is `draggable`. Dropping it (`dragend`) makes its new position the centre.
  - The coordinates are rounded to 5 decimal places (about 1 m) before they become the centre.
- **Label for a map-chosen centre:**
  - the centre's label is "Dropped pin" at once, and the submit button works straight away;
  - in the background, the page asks `GET /api/geocode/reverse` for a place name. If one comes back and the pin hasn't moved since it was asked, the label becomes that name;
  - a failure (503, 502, network, or no result) leaves "Dropped pin" with no error shown, because the pin itself is what counts;
  - while the lookup is in flight, the "Centre:" line reads "Centre: Dropped pin (finding the place name…)";
  - if the Runner saves before the name comes back, "Dropped pin" is saved. That's acceptable.
- **Everything else moves the pin:**
  - a place or postcode search, picking a result, "Use my location" and the confirmed IP fallback all set the centre, as now, and the pin follows;
  - with the map present, a place search that returns results **chooses the first result at once**, so entering a postcode or address moves the pin without another click. The "Places found" list stays, so the Runner can pick a different match. The `PlacePicker` gets this behind an opt-in `chooseFirstResult` prop, passed only with the map. The wizard and Mapped Areas keep pick-to-choose.
- **Framing** (the map's view):
  - **fit the circle** when the centre comes from outside the map: the initial saved Search Area, a place search or pick, "Use my location" or the IP fallback;
  - **fit the circle** when the radius changes;
  - **don't move the view** when the centre comes from the map itself (a drop or drag). The Runner chose that spot at their current zoom, so the view stays put;
  - the form tracks where its centre came from (`'map' | 'elsewhere'`), and the map only refits for `'elsewhere'`, or for a radius change.
- **Gestures:** scroll-wheel zoom is off, so the page scrolls past the map. Unlike the Segment map, one-finger dragging stays **on** for touch devices too, because this map is a picker and the Runner needs to pan it. The page still scrolls by touching outside the map. Zoom works with the +/− buttons and pinch.
- **Hint:** a line under the map reads "Tap or click the map to drop the pin, then drag it to fine-tune."
- **Accessibility:** the map region is `<section aria-label="Search Area map">`. The place search and "Use my location" remain the keyboard path to choosing a centre, so the map doesn't need its own keyboard pin-dropping.
- **Tiles and attribution:** OSM's standard tiles and attribution, exactly as on the Segment map. The page's existing Nominatim attribution stays.

### Reverse geocoding

- **Route:** `GET /api/geocode/reverse?lat=<lat>&lng=<lng>`, for signed-in Runners only. `lat` must be in [−90, 90] and `lng` in [−180, 180], as numbers (anything else is a 400).
  - It replies `{ result: GeocodeResult | null }` (a new shared type, `ReverseGeocodeResponse`);
  - it replies 503 without a Nominatim client, and 502 on a `GeocodeError`, exactly like `GET /api/geocode`.
- **Nominatim:** add `reverse(lat, lng)` to the existing `NominatimClient`.
  - It calls `https://nominatim.openstreetmap.org/reverse` with `format=jsonv2` and `zoom=16` (street level);
  - it shares the **same throttle** as search, so the whole app stays at 1 request per second;
  - it sends the same User-Agent;
  - it maps the reply's `display_name`, `lat` and `lon` with the same validation as search. Nominatim's `{ "error": "Unable to geocode" }` (a point in the sea) maps to `null`.
- **Cache:** the existing `geocode_cache` table, with no migration.
  - The key is `\treverse:<lat>,<lng>`, with both rounded to 4 decimal places (about 11 m). The request to Nominatim uses the same rounded coordinates.
  - The leading tab means a key can never collide with a search, because `normaliseQuery` always trims.
  - The stored value is a 0- or 1-element `GeocodeResult[]`, so the column's type is unchanged and a `null` result is cached too.
- **Not used elsewhere:** "Use my location" keeps its "My location" label. Replacing that is a separate decision (its `TODO(decision)` stays).

### Shared map code

- **Shared module:** before the Search Area map, the parts both maps need move out of `results/segment-map-features.ts` into `apps/web/src/map/`:
  - the tile URL, max zoom and attribution;
  - `MAP_HEIGHT_CLASSES`;
  - the Search Area circle's colour and dash;
  - the circle-bounds maths (today's `searchAreaCircle`);
  - the `toLeaflet` and `toLeafletBounds` helpers.
- **Leaflet stays out of the main bundle:** files in `map/` that the main bundle imports must not import `leaflet` as a value (type-only imports are fine). Both map chunks import Leaflet's CSS. Vite may split Leaflet into a shared chunk; that's fine, as long as it isn't in the main entry.

## Stack

This is unchanged:

- TypeScript (strict), pnpm workspaces, Node 22;
- `apps/api` is Fastify + Drizzle + Postgres 16 (docker compose, host port 5433);
- `apps/web` is React + Vite + Tailwind + React Router, with `leaflet` and `react-leaflet` v5;
- `packages/shared` holds code used by both;
- Vitest, Playwright (`channel: 'chrome'`), ESLint + Prettier.

There are no new dependencies. In particular, there's no Leaflet plugin for arrows or markers.

## Conventions

The core and Segment map conventions still apply (see `docs/ralph/core/PRD.md` and `docs/ralph/segment-map/PRD.md`):

- config comes from `.env` (never read or print it);
- the domain core is pure;
- test at the highest seam that covers the behaviour;
- never store raw Strava JSON;
- never show another athlete's name or photo;
- never call Predicted Time ÷ Target Record a "gap";
- **UI verification:** after UI work, click through with the Playwright MCP browser at desktop and phone width (375 px), then make sure an e2e test covers the same flow;
- e2e tests sign in with `POST /api/test/login`;
- **tiles:** tests never fetch map tiles. Every spec imports `test` from `e2e/tests/fixtures.ts`, whose fixture serves a blank tile;
- **Leaflet in jsdom:** component tests cover what React renders. What to draw is decided in pure modules with their own unit tests. Real map rendering and clicking are covered in e2e. Don't mock Leaflet internals.

New conventions:

- **Nominatim is never reached from tests.**
  - API tests use the injected `fetch`, as the search tests do;
  - e2e specs stub `**/api/geocode/reverse?*` with `page.route`, as they already stub `**/api/geocode?*`. That glob doesn't match the reverse path, so both stubs are needed wherever a pin can drop;
  - the MCP click-through may make a handful of real reverse lookups through the throttled, cached API.
- **Clicking a map in e2e:** a spec drops the pin by clicking the map element at a chosen pixel (`locator.click({ position })`), away from the +/− control and the attribution. It reads the saved centre back from `GET /api/search-area` and asserts it differs from the old one and lies within the map's visible bounds. It doesn't predict exact coordinates from pixels.
- **Pure first:** route-marker geometry (halfway point, bearing, loop detection) and paging maths are pure functions with unit tests, written before the components that use them.

## Out of scope

- server-side paging, or any change to ranking, `GET /api/results`, `POST /api/search`, the Strava budget or the database schema;
- "Show fewer", "Show all", infinite scroll, or remembering the shown counts across visits;
- map → list highlighting, hover highlighting, or restyling the line of the selected Segment;
- more than one direction arrow per route, elevation profiles and distance markers;
- a map in the wizard, in Mapped Areas, or for drawing Mapped Areas;
- a reverse-geocoded label for "Use my location", geocoding autocomplete, and a "search this area" button on the map;
- drawing Known Segments or results on the Search Area map;
- other tile providers, API keys, a satellite layer, and Leaflet plugins;
- editing `CONTEXT.md`. The Runner keeps the glossary.

## Tasks

Work top to bottom. Each task's **Check** must pass, plus `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`, before it's ticked.

### Paged lists

- [ ] **P1** Paging in the lists (spec: UI → Results page):
  - a pure helper in `apps/web/src/results/paging.ts`, with `RESULTS_PAGE_SIZE = 20` and:
    - `INITIAL_SHOWN`, 20 for each list;
    - `visibleRows(rows, shown)`;
    - `nextShown(total, shown)`, which adds up to 20 and caps at the total;
    - `showMoreLabel(total, shown)` → `{ status: 'Showing 20 of 47', button: 'Show 20 more' }`, or null when everything is shown;
  - `ResultsSection` takes optional `shown` and `onShowMore` props. With them, it renders only the visible rows, plus the "Showing … of …" line and the "Show N more" button (with its list-naming `aria-label`) when rows are hidden. Without them, it renders every row, as now;
  - `ResultsView` holds `shown` for the three lists. It resets them on a Search Area change (centre lat/lng or radius), never on a poll, and passes them to the three sections;
  - the wizard's step 3 holds its own `shown` for Your targets;
  - the heading count stays the full total.
  - **Check:**
    - unit tests for `paging.ts`: under, exactly and over a page, the last partial page, and a total that shrinks below `shown`;
    - component tests on `ResultsPage`:
      - 47 targets show 20 rows, "Showing 20 of 47" and "Show 20 more", and the heading says 47;
      - two clicks show all 47 and the button goes, with "Show 7 more" before the last click;
      - a poll that reorders keeps the shown count;
      - a radius change resets it to 20;
      - Suspicious records page separately from targets;
    - a wizard test: step 3 pages Your targets;
    - an e2e test that seeds 25 targets (extend the seeding helper if it needs it) shows 20 rows, clicks "Show 5 more", and sees 25, at desktop and 375 px with no horizontal overflow.

- [ ] **P2** The map draws only the listed Segments:
  - `ResultsView` passes `SegmentMapPanel` the visible slice of Your targets and Nearest misses (Decisions → Map follows the lists);
  - the selection-clearing effect checks the visible rows, so a poll that moves the selected Segment past the shown count clears it;
  - "Show more" never refits the map. Check this holds with the existing `FrameSearchArea` dependencies (centre and radius only), and fix it if not.
  - **Check:**
    - component tests: with 47 targets, the map panel gets exactly 20 targets, then 40 after one "Show more". Assert through what `SegmentMapPanel` is handed (a test seam such as a `data-segment-count` attribute on the map section is fine), not Leaflet internals;
    - a selected Segment pushed past the shown count by a poll clears the selection;
    - e2e with 25 seeded route targets: 20 `segment-map-route` elements, then 25 after "Show 5 more". The map's zoom and centre are unchanged by the click (read through `page.evaluate` on the Leaflet container is fine, or compare the tile requests the fixture recorded);
    - "Show on map" still works on a row revealed by "Show more".

### Start and finish

- [ ] **P3** Route-marker geometry as a pure module:
  - `apps/web/src/results/route-markers.ts`, with `routeMarkers(points)`, returns:
    - `start` and `finish` (the first and last points);
    - `loop` (start–finish distance ≤ `LOOP_THRESHOLD_METRES`, 25 m, by haversine);
    - `arrow: { point, bearingDegrees }`. The point is the halfway point along the route by cumulative haversine distance, interpolated within the leg that contains it. The bearing is that leg's initial great-circle bearing, 0–360 with 0 = north, clockwise;
  - zero-length legs (repeated points) are skipped when finding the arrow's leg;
  - a route whose whole length is 0 puts the arrow on the start, with bearing 0;
  - `SegmentMapFeature` for a route gains `markers` (computed in `segmentMapFeatures`);
  - the colours, radii, loop threshold and arrow size are named constants exported from `segment-map-features.ts` (`START_COLOUR`, `FINISH_COLOUR`, `MARKER_RADIUS = 6`, `LOOP_RING_RADIUS = 9`, `ARROW_SIZE = 16`), replacing `ROUTE_START_RADIUS`.
  - **Check:** unit tests for:
    - a 2-point route (the arrow at the midpoint, the bearing due east and due north for simple cases);
    - a 3-point L-shaped route whose halfway point falls in the second leg;
    - repeated points;
    - a zero-length route;
    - a loop and a non-loop near the threshold;
    - `segmentMapFeatures` attaching markers to routes only.

- [ ] **P4** Draw the start, finish and direction:
  - in `SegmentMap.tsx`, each route draws its line, the arrow, the finish (a dot, or a ring for a loop) and the green start, in that z-order, as in Decisions → Start and finish;
  - the arrow is a non-interactive `Marker` with an `L.divIcon`: a static SVG chevron, rotated with a CSS `transform: rotate(<bearing>deg)` on an inner element, so Leaflet's own positioning transform isn't clobbered;
  - start and finish open the Segment's popup when clicked;
  - add the popup's new line for routes, and the new legend;
  - update class names (`segment-map-start-marker`, `segment-map-finish`, `segment-map-arrow`) and the existing specs that used `segment-map-route-start`.
  - **Check:**
    - component tests: the legend text, and that `SegmentMapPanel` still renders without Leaflet errors in jsdom;
    - e2e (desktop and 375 px):
      - each route target has exactly one start marker filled `#16a34a`, one finish filled `#111827` and one arrow;
      - a seeded loop route's finish is a ring (no fill);
      - a start-only Segment has none of the three;
      - clicking a route's finish opens its popup with the "Starts at the green dot…" line;
      - the arrow's inner element has a `rotate(` transform;
    - MCP click-through: start and finish are distinguishable at default zoom and when zoomed into one Segment, and the arrow points along the route on a seeded diagonal route.

### The Search Area map

- [ ] **P5** Shared map code (a refactor, with no behaviour change):
  - move the shared pieces into `apps/web/src/map/` as in Decisions → Shared map code;
  - `segment-map-features.ts`, `SegmentMap.tsx` and `SegmentMapPanel.tsx` import from there;
  - add a `circleBounds(centre, radiusMetres)` export that the Segment map's circle uses;
  - keep the existing unit tests passing, moving the circle tests alongside the code they test.
  - **Check:**
    - every existing test passes unchanged, apart from import paths;
    - `pnpm build` shows Leaflet still outside the main entry chunk (grep the main entry for `_leaflet_id`);
    - the main entry's size is within 1 kB of what it was before the refactor. Build once before starting, and record both sizes in progress.txt.

- [ ] **P6** Reverse geocoding API:
  - in `packages/shared`, add the `ReverseGeocodeResponse` type;
  - in `nominatim.ts`, add `reverse(lat, lng)` (shared throttle, cache key, `zoom=16`, `null` on Nominatim's error body), and `GET /api/geocode/reverse` in `geocode/routes.ts`, as in Decisions → Reverse geocoding;
  - in `apps/web/src/search-area/api.ts`, add `searchAreaApi.reverseGeocode(lat, lng, signal?)`.
  - **Check:** API tests (`app.inject`, injected `fetch`):
    - the reply's shape, with the request URL's `lat`/`lon` rounded to 4 dp, `zoom=16`, `format=jsonv2` and the User-Agent;
    - the "Unable to geocode" body → `{ result: null }`;
    - a second identical call and a call differing only in the 5th decimal both hit the cache (no second fetch);
    - a cached `null` isn't re-fetched;
    - a search for the literal text `reverse:1,2` doesn't read the reverse entry;
    - out-of-range and non-numeric params → 400;
    - signed out → 401;
    - no client → 503;
    - Nominatim 500 → 502;
    - a search and a reverse lookup made back-to-back are at least `NOMINATIM_INTERVAL_MS` apart (throttle test with fake timers, as the existing throttle tests do).

- [ ] **P7** The Search Area map, showing the chosen centre (spec: UI → Search Area):
  - `search-area/SearchAreaMap.tsx` is the lazy chunk, and `SearchAreaMapPanel.tsx` (main bundle) holds the placeholder and hint line;
  - the map draws the pin and the circle for the current centre and radius, or the world view with no centre;
  - framing follows Decisions → Framing, for the `'elsewhere'` cases and a radius change;
  - gestures: scroll-wheel zoom off, dragging on;
  - `SearchAreaForm` gains `withMap`, tracks the centre's source, and renders the panel in the Centre section. `SearchAreaPage` passes `withMap`;
  - `PlacePicker` gains `chooseFirstResult`, passed with the map, so a search with results chooses the first one at once.
  - **Check:**
    - component tests:
      - the Search Area page shows the placeholder, then the `Search Area map` region and the hint;
      - the wizard's "Where you run" step has no map;
      - a place search on the Search Area page chooses the first result straight away ("Centre: <first label>"), and picking the second changes it;
      - in the wizard, a search still doesn't choose until a pick;
    - e2e (desktop and 375 px, Nominatim stubbed):
      - with a saved Search Area, the pin and circle render, the circle's radius changes when another radius is picked, and the map refits (its zoom changes from 5 km to 1 km);
      - searching a postcode moves the pin to the first stubbed result (compare the pin's screen position before and after, or read the Leaflet marker's position through `page.evaluate`);
      - with no saved Search Area, the map shows no pin;
      - no tile request escapes the fixture;
      - there's no horizontal overflow at 375 px.

- [ ] **P8** Dropping and dragging the pin:
  - a map click drops the pin and a `dragend` moves it. Each sets the centre `{ label: 'Dropped pin', lat, lng }` (rounded to 5 dp) with source `'map'`, so the view doesn't move;
  - then the form calls `reverseGeocode`, aborting any earlier lookup, and applies the name only if the centre still has the same coordinates. The "Centre:" line shows the "(finding the place name…)" suffix while the lookup is in flight;
  - a failed or empty lookup leaves "Dropped pin" silently;
  - saving works with either label.
  - **Check:**
    - component tests on `SearchAreaForm` (drive the centre callback directly, not through Leaflet):
      - a map pick shows "Dropped pin (finding the place name…)" then the reverse label;
      - a second pick before the first lookup resolves ends with the second's label, never the first's;
      - a 503 leaves "Dropped pin" with no alert;
    - e2e (desktop and 375 px, with both geocode stubs):
      - clicking the map moves the pin, shows the stubbed reverse label, and saving goes to Results;
      - `GET /api/search-area` returns a centre that differs from the old one, lies within the map's visible bounds, and has the stubbed label;
      - dragging the pin (`page.mouse` down/move/up on the pin) changes the centre again and doesn't change the map's zoom;
      - a reverse stub replying 503 saves "Dropped pin".

### Wrap-up

- [ ] **P9** Full pass:
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e && pnpm build`. Record in progress.txt the main entry chunk's size and every chunk containing Leaflet (`_leaflet_id`), and confirm the main entry has none;
  - a final MCP click-through as the real Runner (`pnpm dev:live`), at desktop and 375 px:
    - **Results**, against the saved Search Area. Don't start a new search or change the radius, and cap reads with `POST /api/test/live-read-allowance` as M6 did, using at most **10 Strava reads**, checked through the usage counters before and after. Check:
      - lists show 20 with "Show more" where there are more;
      - the map draws only the shown rows, and "Show more" adds to it without moving the view;
      - every route has a green start, a black finish and an arrow pointing the way the Segment runs (spot-check one route's direction against its page on Strava through "View on Strava");
      - loops show the ring;
    - **Search Area page.** Don't press "Save and see results", because that searches and spends Strava reads. Check:
      - the pin and circle match the saved area;
      - a real postcode search moves the pin;
      - dropping and dragging the pin works, and a real reverse lookup labels it (a handful of Nominatim calls at most);
      - the radius buttons resize the circle and refit;
      - the page scrolls past the map on the phone viewport (touching outside it);
    - no console errors on either page, apart from the known favicon 404;
  - update the README's map section: paged lists, start/finish/arrow markers, the Search Area map, and reverse geocoding (it goes through the same 1 request per second throttle and cache).
  - **Check:** everything passes; the click-through finds nothing broken; reads stay within 10; the Search Area was never saved during the live click-through.
