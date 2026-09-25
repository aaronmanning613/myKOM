# What does Strava expose per Segment?

Research for [issue #3](https://github.com/aaronmanning613/myKOM/issues/3) (map: [#1](https://github.com/aaronmanning613/myKOM/issues/1)). Researched 2026-09-25 against Strava's own developer docs, swagger, changelog, API policy and help centre. Terms follow `CONTEXT.md` (Runner, Segment, Segment PB, Target Record, Held Segment, Search Area, Impressiveness).

**Confidence key:** *Documented* = stated in a first-party Strava source (cited). *Unverified* = seen only in community posts or inferred; needs a live API call to confirm.

Primary sources used:

- API reference: <https://developers.strava.com/docs/reference/>
- Swagger: <https://developers.strava.com/swagger/swagger.json>, plus model files `segment.json`, `segment_effort.json`, `athlete.json` under <https://developers.strava.com/swagger/>
- Changelog: <https://developers.strava.com/docs/changelog/>
- "Changes to the Segments API" (May 2020): <https://developers.strava.com/docs/segment-changes/>
- Getting started (tiers, limits): <https://developers.strava.com/docs/getting-started/>
- Authentication (scopes): <https://developers.strava.com/docs/authentication/>
- API Policy (effective 2026-06-01): <https://www.strava.com/legal/api_policy>
- Strava announcement "An Update To Our Developer Program" (2026-06-01, Strava Community Manager): <https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428>
- Help centre, subscription features: <https://support.strava.com/en-us/articles/15402044-strava-subscription-features>

---

## 1. Headline: 2026 platform changes matter more than any field

These landed in the last few months and change what myKOM can be. They go beyond the fields the ticket asked about.

| Change | Date | Source |
|---|---|---|
| **`GET /segments/explore` restricted to approved Extended Access Tier apps.** This is the only documented endpoint that finds Segments by area (bounding box, `activity_type=running`, top 10 results). | Announced 2026-06-01, effective **2026-09-01** | [changelog](https://developers.strava.com/docs/changelog/); [reference](https://developers.strava.com/docs/reference/#api-Segments-exploreSegments) ("Available only to Extended Access Tier apps with granted permission"); [announcement](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) |
| **The developer needs a Strava subscription** to create an app. Existing Standard Tier devs had a 3-month transition. | 2026-06-01 | [getting started](https://developers.strava.com/docs/getting-started/) ("A Strava subscription is a prerequisite for creating an app"); [announcement](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428); [API policy](https://www.strava.com/legal/api_policy) |
| **Standard Tier is capped at 10 connected athletes** (self-upgrade from single-player mode). More needs a review for Extended Access, which Strava describes as generally for 10,000+ users. | 2026-06-01 | [getting started](https://developers.strava.com/docs/getting-started/); [announcement](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428); [API policy](https://www.strava.com/legal/api_policy) |
| Rate limits (upgraded Standard): read 200 / 15 min and 2,000 / day; overall 400 / 15 min and 4,000 / day. | current | [getting started](https://developers.strava.com/docs/getting-started/) |
| **API Policy: an app may not display or disclose Strava Data related to other users, "even if such data is publicly viewable"**, and may show a user's data only to that user. Cache at most **7 days**. No use in any AI application. | effective 2026-06-01 | [API policy](https://www.strava.com/legal/api_policy) |
| Base URL moves to `https://api-v3.strava.com` (available from 2027-01-04). Tokens must go in headers by 2027-06-01. | future | [changelog](https://developers.strava.com/docs/changelog/); [announcement](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428) |

---

## 2. Target Record (KOM/QOM time): `xoms`

- **Not documented.** Neither the `DetailedSegment` / `SummarySegment` schema nor the `getSegmentById` example response has an `xoms` (or `local_legend`) property. A text search of the swagger files and the HTML reference finds no "xoms". Sources: [segment.json](https://developers.strava.com/swagger/segment.json), [reference](https://developers.strava.com/docs/reference/#api-Segments-getSegmentById).
- **Unverified (community only):** forum members say `GET /segments/{id}` in practice returns an `xoms` object with `kom` and `qom` times (other keys and the value format are not shown in a first-party source) and a `local_legend` object. [Community thread, 2024-09](https://communityhub.strava.com/developers-api-7/accessing-kom-qom-data-for-segment-1999) and [2025-07](https://communityhub.strava.com/developers-api-7/local-legend-data-in-apis-10626). No Strava staff confirmed this. In the first thread a subscriber said they did *not* get `xoms`. Treat the field as undocumented and unstable: Strava can remove it without a changelog entry. Also unverified: whether it needs the Runner to be a subscriber, and whether the value is a formatted string rather than seconds. A live call is needed to settle both.
- **Policy risk:** the KOM/QOM time belongs to another athlete's effort. The [API policy](https://www.strava.com/legal/api_policy) bars showing "Strava Data related to other users, even if such data is publicly viewable". Whether an anonymous record *time* (no name) counts is **unverified / a legal reading**. It needs a decision.

## 3. Segment leaderboard endpoint

- `GET /segments/{id}/leaderboard` is **not available**. It was removed in the May 2020 free/subscription split: announced 2020-05-18, with a 30-day migration that ended 2020-06-18. After that the affected endpoints "either omit the data or return an error". Source: [segment-changes](https://developers.strava.com/docs/segment-changes/).
- The endpoint no longer appears in the current reference or swagger, though old changelog entries still link to it (2015-02-07 "Document ... segment leaderboard"; 2017 weight class/age group additions). Sources: [changelog](https://developers.strava.com/docs/changelog/), [swagger](https://developers.strava.com/swagger/swagger.json).
- So there is **no documented way to read a gender-filtered top time**. `xoms` (undocumented) is the only candidate.

## 4. Counts (for Impressiveness)

On `DetailedSegment`, returned by `GET /segments/{id}`, all documented ([segment.json](https://developers.strava.com/swagger/segment.json)):

- `athlete_count`: "number of unique athletes who have an effort for this segment"
- `effort_count`: "total number of efforts for this segment"
- `star_count`: "number of stars for this segment"

These are **not** on `SummarySegment` or on `ExplorerSegment` (the explore result), so each Segment needs its own `GET /segments/{id}`. That call counts against the read limit. Scope: `read` covers public Segments ("Read public segments ... and leaderboards"); `read_all` is needed for private ones ([swagger securityDefinitions](https://developers.strava.com/swagger/swagger.json); [reference](https://developers.strava.com/docs/reference/#api-Segments-getSegmentById)).

## 5. Distance / elevation / grade (for Predicted Time)

Documented on `SummarySegment`, and so also on `DetailedSegment` ([segment.json](https://developers.strava.com/swagger/segment.json)):

| Field | Meaning |
|---|---|
| `distance` | metres |
| `average_grade`, `maximum_grade` | percent |
| `elevation_high`, `elevation_low` | metres |
| `climb_category` | 0–5 |
| `activity_type` | `Ride` or `Run` (filter to `Run`) |
| `start_latlng`, `end_latlng`, `city`, `state`, `country`, `private` | |

`DetailedSegment` only: `total_elevation_gain` (metres), `map.polyline`, `hazardous`, `created_at`, `updated_at`.
`ExplorerSegment` (explore result) only: `distance`, `avg_grade`, `elev_difference`, `climb_category`, `points` (polyline), `start_latlng`/`end_latlng`.
Full elevation profile: `GET /segments/{id}/streams` (`read`; `read_all` for private) ([reference](https://developers.strava.com/docs/reference/#api-Streams-getSegmentStreams)).

## 6. The Runner's Segment PB: `athlete_segment_stats`

- Added to the Segment model on 2020-06-29 ([changelog](https://developers.strava.com/docs/changelog/)). The example response on `GET /segments/{id}` shows `athlete_segment_stats: { pr_elapsed_time, pr_date, effort_count }` ([reference](https://developers.strava.com/docs/reference/#api-Segments-getSegmentById)).
- The schema is internally inconsistent. `SummarySegment.athlete_pr_effort` references `SummaryPRSegmentEffort` (`pr_activity_id`, `pr_elapsed_time`, `pr_date`, `effort_count`), while `athlete_segment_stats` references `SummarySegmentEffort` (`id`, `elapsed_time`, `is_kom`, ...). The examples use the PR shape. **Unverified which shape actually returns.** Sources: [segment.json](https://developers.strava.com/swagger/segment.json), [segment_effort.json](https://developers.strava.com/swagger/segment_effort.json).
- **Scope:** "read_all scope required in order to retrieve athlete-specific segment information" ([reference, getSegmentById](https://developers.strava.com/docs/reference/#api-Segments-getSegmentById)).
- **Subscription:** the 2020 changes say "Segment Effort & Leaderboard data ... are only available for subscribers" on `/segments/:id`, `/segment_efforts`, `/segment_efforts/:id/streams` and `/activities/:id` ([segment-changes](https://developers.strava.com/docs/segment-changes/)). `GET /segment_efforts` (all the Runner's efforts on a Segment) and `GET /segment_efforts/{id}` are each marked "Requires subscription" ([reference](https://developers.strava.com/docs/reference/#api-SegmentEfforts-getEffortsBySegmentId)). This is read as the **Runner's** Strava subscription. **Unverified:** whether a non-subscriber Runner gets `athlete_segment_stats` at all.
- A possible fallback is the same page's line that "Individual segment efforts, segment efforts within activities, personal achievements (PRs) and top 10 leaderboard rankings are still available regardless of subscription status" ([segment-changes](https://developers.strava.com/docs/segment-changes/)). That suggests a free Runner's PB could be rebuilt from `GET /activities/{id}` → `segment_efforts[]` (scope `activity:read` / `activity:read_all`), costing one call per activity. That line contradicts the same page listing `/activities/:id` as subscriber-only. **Unverified.**

## 7. Can we tell whether the Runner holds the Target Record (Held Segment)?

No documented endpoint lists "my KOMs/QOMs". The legacy `/athletes/{id}/koms` is not in the current swagger ([swagger paths](https://developers.strava.com/swagger/swagger.json)). What exists:

| Signal | Where | Notes | Source |
|---|---|---|---|
| `is_kom` (boolean) | `SummarySegmentEffort` | "Whether this effort is the current best on the leaderboard". Not stated whether that means the overall board or the gender board, so it may not match Target Record for women. **Unverified.** | [segment_effort.json](https://developers.strava.com/swagger/segment_effort.json) |
| `kom_rank` (1–10) | `DetailedSegmentEffort` | Rank on the "global leaderboard if it belongs in the top 10 **at the time of upload**". Stale: does not show a later loss of the record. | [segment_effort.json](https://developers.strava.com/swagger/segment_effort.json) |
| `pr_rank` (1–3) | `DetailedSegmentEffort` | Runner's own top 3 at upload. | same |
| `achievements[]` | effort in activity detail | Appears in examples, but its schema file (`achievement.json`) returns 404. **Undocumented.** | [reference](https://developers.strava.com/docs/reference/) |
| Compare Segment PB with `xoms` | `/segments/{id}` | Works only if `xoms` is really returned (see §2). Needs the Runner's sex (below). | inferred |
| `local_legend` | `/segments/{id}` | Undocumented (community only). Local Legend means most efforts in 90 days, which is **not** the Target Record. | [community](https://communityhub.strava.com/developers-api-7/local-legend-data-in-apis-10626) |
| Starred Segments | `GET /segments/starred` (`read`; `read_all` for private) | Useful as a seed list of Segments near the Runner. Says nothing about holding records. | [reference](https://developers.strava.com/docs/reference/#api-Segments-getLoggedInAthleteStarredSegments) |

Best documented option: `athlete_segment_stats.is_kom`, if the effort shape is what returns, or the `is_kom` on the Runner's efforts. Both need `read_all` and probably a Runner subscription. The most reliable check is the undocumented one: PB ≤ `xoms.kom`/`qom`.

## 8. The Runner's sex

- `sex` (`"M"` or `"F"`) is on **`SummaryAthlete`** ([athlete.json](https://developers.strava.com/swagger/athlete.json)). `GET /athlete` returns the summary to any token and the detailed form with `profile:read_all` ([reference](https://developers.strava.com/docs/reference/#api-Athletes-getLoggedInAthlete)). So base `read` should be enough.
- It is optional in Strava profiles and only has two values. myKOM needs a fallback, such as asking the Runner, when it is missing. **Unverified:** how often it is null.

## 9. Scope and subscription matrix

Scope meanings are from the [swagger securityDefinitions](https://developers.strava.com/swagger/swagger.json) and [authentication docs](https://developers.strava.com/docs/authentication/). Since 2026-04-23 the token response also returns a `scope` field ([changelog](https://developers.strava.com/docs/changelog/)).

| Need | Endpoint / field | Scope | Subscription / tier |
|---|---|---|---|
| Find Segments in a Search Area | `GET /segments/explore` | `read` | **Extended Access Tier only (since 2026-09-01)** |
| Segment geometry, distance, grade, elevation | `GET /segments/{id}` | `read` (`read_all` if private) | developer subscription (Standard Tier) |
| athlete/effort/star counts | `GET /segments/{id}` | `read` | same |
| Target Record time | `xoms` on `GET /segments/{id}` | `read`? | **undocumented**; policy question |
| Leaderboard | `/segments/{id}/leaderboard` | n/a | **removed 2020-06-18** |
| Segment PB | `athlete_segment_stats` on `GET /segments/{id}` | `read_all` | Runner subscription (per 2020 changes; unverified in practice) |
| All the Runner's efforts on a Segment | `GET /segment_efforts?segment_id=` | `activity:read` (inferred; not stated) | "Requires subscription" |
| Held Segment | `is_kom` / `kom_rank` on efforts | `read_all` / `activity:read` | Runner subscription likely |
| Starred Segments | `GET /segments/starred` | `read` (`read_all` for private) | developer subscription |
| Runner's sex | `GET /athlete` → `sex` | `read` | none beyond developer |
| Benchmarks (for context) | `GET /activities/{id}` → `best_efforts` | `activity:read` / `activity:read_all` | not researched here |

---

## Implications for myKOM

1. **Segment discovery by Search Area is now blocked** for a Standard Tier app, because `/segments/explore` has been Extended Access only since 2026-09-01. Explore also returned only the top 10 per bounding box. myKOM needs another source of Segment IDs (the Runner's starred Segments, Segments in the Runner's own activities, or tiling plus an Extended Access application). Otherwise the Search Area concept must be rethought. **This may be a blocker for the map.**
2. **Scale is capped at 10 Runners** without Strava's review, and the developer must be a Strava subscriber. As things stand, myKOM is a personal / small-group tool.
3. **Target Record time depends on the undocumented `xoms` field.** Nothing documented replaces the leaderboard, and showing another athlete's record may conflict with the API Policy's other-users clause. Build a spike that calls `/segments/{id}` live and checks whether `xoms` comes back, for free and for subscriber Runners.
4. **Impressiveness is well supported** (`athlete_count`, documented). **Predicted Time inputs are well supported** (`distance`, `average_grade`, `elevation_high`/`low`, `total_elevation_gain`, streams). All of these need one `GET /segments/{id}` per Segment, which uses the 200 / 15 min read budget. Cache for at most 7 days.
5. **Segment PB and Held Segment likely need the Runner to be a Strava subscriber** and to grant `read_all`. Plan a degraded mode for free Runners, such as rebuilding the PB from activity segment efforts (unverified).
6. **Runner's sex** is cheap (`GET /athlete`, `read`), but still needs a fallback prompt when it is unset.
7. Request scopes `read,read_all,activity:read_all` and check the returned `scope`, because Runners can untick scopes.
