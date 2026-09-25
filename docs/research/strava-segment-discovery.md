# How does Strava segment discovery work?

Research for [issue #2](https://github.com/aaronmanning613/myKOM/issues/2). Researched 2026-09-25 against Strava's own developer docs, swagger spec, API Agreement/Policy and support pages. Terms follow `CONTEXT.md` (Runner, Segment, Search Area, Target Record, Impressiveness).

Anything not confirmed by a primary source is marked **(unverified)**.

## TL;DR

- **`GET /segments/explore` is no longer available to an app like myKOM.** Since **1 September 2026** it is restricted to approved **Extended Access Tier** apps, a tier that generally means 10,000+ users and is granted case by case. A personal or small-group app sits in the Standard Tier, so it cannot call this endpoint.
- Even with access, the endpoint returns only the **top 10** segments per bounding box, ranked by an undocumented measure of popularity. Covering a 50 km Search Area would need hundreds to thousands of calls, which would use up a Standard-tier daily read budget.
- Without Explore, the Standard Tier offers no geographic search. The Segments myKOM can find are the ones a Runner has run (from their activities), starred, or that lie on their saved routes, plus any Segment whose ID is already known.
- Segment data may be cached for **at most 7 days** (API Policy §6.2).

## 1. `GET /segments/explore`: what it does

| Aspect | Finding | Source |
|---|---|---|
| Access | "Available only to Extended Access Tier apps with granted permission." | [swagger.json](https://developers.strava.com/swagger/swagger.json) (`/segments/explore`), [API reference](https://developers.strava.com/docs/reference/#api-Segments-exploreSegments) |
| When restricted | Changelog, 1 Sep 2026: "Explore Segments endpoint restricted to approved Extended Access Tier developers". Announced 1 Jun 2026. | [Changelog](https://developers.strava.com/docs/changelog/) |
| Results per call | "Returns the top 10 segments matching a specified query." No `page`/`per_page` parameters exist, so the endpoint cannot be paginated. | [swagger.json](https://developers.strava.com/swagger/swagger.json) |
| `bounds` (required) | Array of 4 floats, CSV: `[sw_lat, sw_lng, ne_lat, ne_lng]` (rectangle only, no centre+radius) | [swagger.json](https://developers.strava.com/swagger/swagger.json) |
| `activity_type` | enum `running` \| `riding` | [swagger.json](https://developers.strava.com/swagger/swagger.json) |
| `min_cat` / `max_cat` | Integers 0–5, climb category (0 = uncategorised, 5 = HC). No other filters exist: none for distance, surface or grade. | [swagger.json](https://developers.strava.com/swagger/swagger.json), [segment.json](https://developers.strava.com/swagger/segment.json) |
| Response (`ExplorerSegment`) | `id, name, climb_category, climb_category_desc, avg_grade, start_latlng, end_latlng, elev_difference, distance, points` (polyline). **No `athlete_count`, `effort_count` or record data.** | [segment.json](https://developers.strava.com/swagger/segment.json) |
| What "top" means | Not defined by the API docs. **(unverified)** that it matches the website/app Segment Explore, which Strava's help pages describe as "a sampling of popular segments" / "the most popular segments near you". | [Help: finding segments in the app](https://support.strava.com/en-us/articles/15401734-finding-segments-on-the-strava-app), [Help: finding segments on the website](https://support.strava.com/hc/en-us/articles/216918147-How-to-Find-Segments-on-the-Strava-Website) |

Because the response has no `athlete_count`, myKOM would need a follow-up `GET /segments/{id}` for each Segment to measure Impressiveness. `DetailedSegment` carries `athlete_count`, `effort_count` and `star_count` ([segment.json](https://developers.strava.com/swagger/segment.json)).

### Who can get Extended Access

- API Policy §3.3: the Standard Tier has two levels, capped at 10 users and at 9,999 users. The Extended Access Tier is "generally inclusive of Developer Applications serving 10,000 users or more and approved by Strava", and apps are "admitted on a case-by-case basis". Source: [API Policy (2026)](https://www.strava.com/legal/api_policy).
- Strava's June 2026 announcement: Explore access is kept only for "approved applications in our Extended Access Tier with qualifying use cases". Qualifying use cases are not published. Source: [Strava Community Hub, "An Update To Our Developer Program"](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428).
- API Policy §3.2: Strava "may maintain an allowlist" for restricted endpoints, and developers who want to be considered should email developers@strava.com. Source: [API Policy (2026)](https://www.strava.com/legal/api_policy). Whether a 10-user hobby app would get onto that allowlist is **(unverified)**. Nothing in the sources suggests it would.

## 2. Covering a Search Area of up to 50 km (hypothetical: only if Explore access were granted)

A circular Search Area has to be split into rectangular `bounds` tiles. Each tile returns at most 10 Segments, so dense tiles must be split again until each returns fewer than 10 (a quadtree). That fewer-than-10 result shows the tile is not saturated, **(unverified)**: Strava does not document whether explore returns every matching Segment when fewer than 10 exist.

At latitude φ, 1 km ≈ 1/111° of latitude and ≈ 1/(111·cos φ)° of longitude (standard geodesy, not Strava-specific).

Tile counts for the bounding square of radius R (the circle alone needs about π/4 as many):

| Radius R | 5 km tiles | 2 km tiles | 1 km tiles |
|---|---|---|---|
| 5 km | 4 | 25 | 100 |
| 10 km | 16 | 100 | 400 |
| 25 km | 100 | 625 | 2,500 |
| 50 km | 400 (~314 in circle) | 2,500 (~1,964) | 10,000 (~7,854) |

These counts cover only the explore calls. Each distinct Segment found then costs one `GET /segments/{id}` to get `athlete_count`. At up to 10 per tile, that is up to about 3,000–4,000 detail calls for 50 km with 5 km tiles.

**Does tiling surface all Segments?** Not guaranteed. The endpoint returns the "top 10" by an undocumented ranking ([swagger.json](https://developers.strava.com/swagger/swagger.json)). Strava's consumer Explore is described as showing "a sampling" of popular Segments ([help](https://support.strava.com/en-us/articles/15401734-finding-segments-on-the-strava-app)). Whether small enough tiles would eventually return obscure, rarely-run Segments is **(unverified)**. Older reports from the developer community say that shrinking the box does surface more Segments, but that is not a primary source.

## 3. Rate limits, and what they mean per search

Source for all rows: [Rate Limits](https://developers.strava.com/docs/rate-limits/) and [Getting Started](https://developers.strava.com/docs/getting-started/).

| App state | Overall (15 min / day) | Read ("non-upload") (15 min / day) | Athlete capacity |
|---|---|---|---|
| Default, new app ("Single Player Mode") | 200 / 2,000 | 100 / 1,000 | 1 |
| Self-service upgrade from the API Settings Dashboard | 400 / 4,000 | 200 / 2,000 | 10 |

- The "non-upload" (read) limit covers every endpoint except `POST /activities`, `POST /uploads` and upload_media, so all discovery calls count against it ([Rate Limits](https://developers.strava.com/docs/rate-limits/)).
- The 15-minute windows reset at :00, :15, :30 and :45. The daily limit resets at midnight UTC. Going over the limit returns `429`, and rejected requests still count toward the daily limit. Usage is reported in the `X-RateLimit-*` and `X-ReadRateLimit-*` headers as `15min,daily` ([Rate Limits](https://developers.strava.com/docs/rate-limits/)).
- Limits are **per application**, so all of myKOM's Runners share one budget ([Rate Limits](https://developers.strava.com/docs/rate-limits/)).
- A Strava subscription is required to create an app ([Getting Started](https://developers.strava.com/docs/getting-started/)). Standard Tier apps carry subscription requirements ([API Policy §3.3](https://www.strava.com/legal/api_policy)).

**Calls per search on the upgraded Standard Tier (200 reads per 15 min, 2,000 per day)**, if Explore were available:

- A 10 km radius with 2 km tiles is about 100 explore calls plus up to about 1,000 detail calls. That fills roughly 6 fifteen-minute windows and more than half of the day's budget.
- A 50 km radius with 5 km tiles is about 314–400 explore calls. The explore calls alone fill 2 windows and about 20% of the daily budget. The detail calls would take more than a full day's budget.
- **A 50 km search is not practical on Standard-tier limits**, even before counting the access restriction.

## 4. Alternative discovery routes available to a Standard Tier app

None of these is a geographic search. Each finds Segments connected to the Runner.

| Route | How | Coverage / cost | Source |
|---|---|---|---|
| Segments from the Runner's own activities | `GET /athlete/activities` (`per_page` up to 200), then `GET /activities/{id}?include_all_efforts=true`. `segment_efforts[]` includes each Segment. | Only Segments the Runner has already run. One call per activity, which is expensive for a first import (overlaps with #4 and #9). | [swagger.json](https://developers.strava.com/swagger/swagger.json), [activity.json](https://developers.strava.com/swagger/activity.json), [Pagination](https://developers.strava.com/docs/#Pagination) |
| Starred Segments | `GET /segments/starred` (paginated) | Only Segments the Runner has starred, for example after finding them in Strava's own Explore map. Cheap. | [swagger.json](https://developers.strava.com/swagger/swagger.json) |
| Segments on the Runner's routes | `GET /athletes/{id}/routes`: the `Route` model has `segments` ("The segments traversed by this route") | Only routes the Runner created. A Runner could draw a route through an area of interest in Strava's route builder to collect its Segments. Whether the list endpoint (not just `GET /routes/{id}`) fills in `segments` is **(unverified)**. | [swagger.json](https://developers.strava.com/swagger/swagger.json), [route.json](https://developers.strava.com/swagger/route.json) |
| Known Segment ID | `GET /segments/{id}` | The Runner pastes a Segment URL or ID. Returns `DetailedSegment` with `athlete_count`. | [swagger.json](https://developers.strava.com/swagger/swagger.json) |
| Ask Strava | Email developers@strava.com to be considered for the restricted-endpoint allowlist | Approval is discretionary and unlikely for a small app **(unverified)**. | [API Policy §3.2](https://www.strava.com/legal/api_policy) |
| Scraping strava.com | Prohibited: "You may not use web scraping … or any other automated means to extract data from the Strava Platform." | Not an option. | [API Policy §5.5](https://www.strava.com/legal/api_policy) |
| Strava MCP | Official agent interface, for personal use of a subscriber's own data only. "may not be used to enable any commercial or third-party access". | Not an app data source. | [API Policy §3.5](https://www.strava.com/legal/api_policy) |

Related platform rules that affect discovery design:

- **7-day cache:** "You may not retain Strava Data in your cache for longer than seven (7) days", and a Segment that is no longer available must be removed immediately. Storing Strava Data in any "Persistent Index" is prohibited. Source: [API Policy §6.2, §5.5](https://www.strava.com/legal/api_policy). The API Agreement's "Strava Data" explicitly includes "Strava segment and leaderboard data" ([API Agreement §2.3](https://www.strava.com/legal/api)).
- **Sharing between Runners:** the API Agreement says Strava Data from one user may be shown only to that user ([API Agreement](https://www.strava.com/legal/api)). API Policy §6.1 frames this as applying "Unless your Developer Application has an athlete capacity of 9,999 or less" ([API Policy §6.1](https://www.strava.com/legal/api_policy)). The two documents read inconsistently. Whether myKOM may show Segments found through one Runner's activities to another Runner is **(unverified)**.
- **Records:** the segment leaderboard endpoint was removed in 2020 ([Segment Changes](https://developers.strava.com/docs/segment-changes)). The current swagger `DetailedSegment` has no KOM/QOM field ([segment.json](https://developers.strava.com/swagger/segment.json)). Whether the live API still returns an undocumented record field is **(unverified)**. This belongs to issue #3 but affects the whole approach.

## Implications for myKOM

1. **The main flow in the map (pick a Search Area, get ranked Segments nearby) cannot be built on the public API.** myKOM is a Standard Tier app by design (small group, public launch out of scope), and Explore now requires Extended Access. The decision behind issue #10 (Segment discovery and caching strategy) needs to change. The choice is between (a) asking Strava for allowlist access, a long shot that should not block the spec, and (b) redefining discovery around the Runner's own Segments: those they have run, starred, or that lie on their routes. The Search Area then becomes a filter over those Segments rather than a query to Strava.
2. **Option (b) changes the product.** It finds records on Segments the Runner has already run (or deliberately starred or routed through), not new Segments nearby. Starring Segments in Strava's own Explore map could be the supported way to add new candidates.
3. **Budget:** with 200 reads per 15 min and 2,000 per day shared across up to 10 Runners, any design must be incremental: backfill slowly, use webhooks for new activities, and fetch Segment details lazily.
4. **Storage:** Segment data cannot be kept in Postgres indefinitely. It must expire or be refreshed within 7 days, which affects the data model (#12).
5. **Open questions to raise:** whether the Target Record is available at all (#3), and whether Segments found by one Runner may be shown to another in the group (policy wording is ambiguous).
