# Strava best efforts, API cost, and API terms

Research for [#4](https://github.com/aaronmanning613/myKOM/issues/4): how do we get a Runner's lifetime best efforts, and what do Strava's rules allow us to store? Sources were checked on 2026-09-25. Terms use the glossary in `CONTEXT.md`.

Every claim cites a primary source. Anything marked **Unverified** is my own inference, or something no primary source states.

## TL;DR

- **Distances:** Strava calculates running best efforts for 400m, 1K, 1/2 mile, 1 mile, 2 miles, 5K, 10K, 15K, 10 miles, 20K, half marathon, 30K, marathon and 50K. **3K is not on the list.** Times are elapsed time, not moving time. [S1]
- **No bulk endpoint:** `best_efforts` exists only on `DetailedActivity` (`GET /activities/{id}`), so it costs one call per run. No athlete-stats or PR endpoint returns them. [S2, S3]
- **Import cost:** 3,000 runs cost about 3,015 read calls. At the 10-athlete tier (200 reads per 15 min, 2,000 per day) that takes 2 UTC days. At the single-player default (100 per 15 min, 1,000 per day) it takes about 4 days. The budget is shared by the whole app. [S4, S5]
- **Terms:** the 2026 API Policy has rules that clash with several standing decisions:
  - a **7-day cache limit** on Strava Data [S7 §6.2]
  - a ban on displaying **other users' data**, including KOM/QOM holders' times [S7 §2.3, S6]
  - a broad **AI ban** [S7 §5.3]
  - deletion within 30 days of deauthorization [S7 §7.4]
- **Also found:** Explore Segments (`/segments/explore`) has been restricted to Extended Access Tier apps since **2026-09-01** [S8], and there has been no leaderboard endpoint since 2020 [S9]. The API has no documented way to find Segments in a Search Area or to read a Target Record time.

## 1. Which distances get best efforts (is 3K included?)

- Strava's help article lists the running best-effort distances as 400m, 1K, 1/2 mile, 1 mile, 2 miles, 5K, 10K, 15K, 10 miles, 20K, half marathon, 30K, marathon and 50K. **3K is not included.** [S1]
- Strava tracks "your top three lifetime efforts and top ten annual efforts at each distance". [S1]
- Best efforts use the activity's **elapsed time**, not moving time. [S1]
- Strava needs good-quality GPS to calculate a best effort. Sections with missing or errant points, or false accelerations, are not eligible. [S10]
- **Unverified:** no primary source says whether manual or treadmill runs get best efforts. The same goes for Only Me runs and flagged runs. Expect GPS-less runs to have none.
- **Unverified:** the API reference types `best_efforts` as an array of `DetailedSegmentEffort` [S2, S3]. It does not list the distances. I assume the API returns the same set as the app, with the distance name in the `name` field.

**Consequence:** the standing decision "3k dropped if Strava doesn't provide it" applies. The Benchmark set is up to the 14 distances above. myKOM can pick a subset, for example 400m to half marathon for segment-length efforts.

## 2. Where best efforts come from: per activity or in bulk?

- **Per activity only.** `best_efforts` is a property of `DetailedActivity`, which `GET /activities/{id}` returns. [S2, S3]
- `SummaryActivity`, which `GET /athlete/activities` returns, has **no** `best_efforts`. [S2]
- That list endpoint pages at up to 200 items per page with `per_page`. [S2, S11]
- `GET /athletes/{id}/stats` (`ActivityStats`) returns only totals: recent (4 weeks), year-to-date and all-time run totals, plus the biggest ride and climb. It has no best efforts. [S2]
- It also "only includes data from activities set to Everyone visibility". [S3]
- The API has no PR or best-effort endpoint. The full endpoint list in the official swagger has nothing like it. [S2]
- Each best-effort item is a `DetailedSegmentEffort`. It carries `elapsed_time`, `moving_time`, `distance`, `start_date` and `pr_rank`. `pr_rank` is "the rank of the effort on the athlete's leaderboard if it belongs in the top 3 at the time of upload". [S2]
  - `pr_rank == 1` marks a lifetime PR at upload time.
  - A PR can be beaten or deleted later, so the lifetime best still has to be recomputed as the minimum over all stored efforts.
- **Possible optimisation (unverified):** `SummaryActivity.achievement_count` gives "the number of achievements gained during this activity" [S2]. If best-effort PRs count as achievements, the import only needs `GET /activities/{id}` for runs with `achievement_count > 0`. Every lifetime-best effort was a PR (`pr_rank` 1) when it was uploaded, so it would be caught. Test this against a real account before relying on it.
- **Unverified:** the 2020 segment changes made segment-effort data on `/activities/{id}` subscriber-only [S9]. No source says whether `best_efforts` on that endpoint is also gated. The app owner needs a Strava subscription anyway (see §4).

## 3. Call cost and wall-clock time of an import

### Rate limits

All limits are **per application**, not per Runner. [S4]

| Tier | Read (non-upload) limit | Overall limit | Athletes |
|---|---|---|---|
| Default / single-player | 100 per 15 min, 1,000 per day | 200 per 15 min, 2,000 per day | 1 |
| Self-service upgrade | 200 per 15 min, 2,000 per day | 400 per 15 min, 4,000 per day | 10 |

- The 15-minute windows reset at :00, :15, :30 and :45. The daily limit resets at midnight UTC. [S4]
- An over-limit request returns 429, and "requests violating the short term limit will still count toward the long term limit". [S4]
- Usage is reported in the `X-RateLimit-*` and `X-ReadRateLimit-*` headers. [S4]
- The API Policy forbids circumventing rate limits [S7 §3.7]. Rotating multiple apps or tokens is also out: one API token per app [S6 §1.1], and tokens may not be multiplexed [S7 §5.16].

### Cost of one Runner's import

- Calls = ceil(activities ÷ 200) list pages + one `GET /activities/{id}` per run.
- The list endpoint cannot filter by sport, so rides and other activities also use list pages.

| Runs | Calls (approx.) | 10-athlete tier (200 per 15 min, 2,000 per day) | Single-player (100 per 15 min, 1,000 per day) |
|---|---|---|---|
| 1,000 | ~1,005 | ~6 windows, about 1.25 h, within one day | ~11 windows, about 2.5 h, but over the 1,000 daily limit: finishes the next UTC day |
| 3,000 | ~3,015 | 2,000 on day 1, then ~1,015 on day 2: **2 UTC days** | about **4 UTC days** |

- These are best cases for one Runner importing alone.
- Several friends importing at once share the same budget.
- Ongoing sync also draws on the same budget. Strava recommends webhooks over polling. [S4, S12]
- The achievement-count filter (§2, unverified) could cut detail calls by a large, unknown factor.

## 4. Athlete capacity and how to raise it

- New apps start in **Single Player Mode** with an athlete capacity of 1. [S4, S5]
- **A Strava subscription is a prerequisite for creating an app.** [S5]
- A self-service upgrade in the API Settings Dashboard raises capacity to **10 athletes** with the higher limits above. [S4, S5]
- Going past 10 needs an app review through the Developer Program form. "Until your app has been reviewed, you won't be able to authenticate any additional athletes." [S4]
- The review asks for screenshots of every place Strava data appears, plus the "Connect with Strava" button. [S4]
- Increases are not guaranteed, and Strava sets no service-level agreement for review time. [S4, S7 §3.6]
- The Policy defines Access Tiers [S7 §3.3]:
  - **Standard:** 10 users, or 9,999 users
  - **Extended Access:** usually 10,000+ users, admitted case by case
- Standard Tier apps "are subject to subscription requirements". The developer or specified end users may need to keep an active Strava subscription. [S7 §3.3]
- **Unverified:** I could not find the published subscription requirements for each tier on developers.strava.com. The Runners themselves may also need subscriptions.

**For myKOM:** "you plus a few friends" fits the self-service 10-athlete tier, with no review needed. That caps the group at 10 Runners, including the developer.

## 5. API Agreement and API Policy: storage, display, AI, deletion

- The API Agreement (effective 2026-06-01) incorporates the **Strava API Policy** by reference. The detailed operating rules are in the Policy. [S6, S7]
- "Strava Data" means all data accessed through the API, "including … Strava segment and leaderboard data". [S6 §2.3(i)]

### Caching and retention

- "You may not retain Strava Data in your cache for longer than seven (7) days." [S7 §6.2]
- A resource that is no longer available from Strava must be removed immediately. [S7 §6.2]
- "Except for such limited caching, you may not store Strava Data." [S7 §6.2]
- No Strava Data, **or data derived from Strava Data**, may be stored in a "Persistent Index". That is any storage "configured to enable subsequent retrieval, query, or use". The seven-day transient cache is exempt. [S7 §5.5]
- Bulk accumulation into a database "that exceeds the operational scope" of the app is forbidden. [S7 §5.5]
- Data may be retained "only so long as necessary for the purpose for which it was originally obtained". [S7 §6.4]
- Storing or caching geographic or other user information is forbidden except as §6.2 allows. [S7 §5.7]
- Data a user deletes on Strava must stop being shown within **48 hours**. [S7 §6.3]

### Displaying other athletes' data

- "Strava Data provided by a specific Strava user may be displayed or disclosed in your Developer Application only to that user." This applies to data on other users "even if such data is publicly viewable on the Strava Platform". [S7 §2.3; also S6 highlights]
- A user's data may not be shared with other users of the app without explicit consent. [S6 highlights; S7 §5.13]
- **Ambiguity:** §6.1 says "*Unless* your Developer Application has an athlete capacity of 9,999 or less, you may display … only the specific Strava Data related to that end user". Read literally, that relaxes the rule for small apps. It contradicts §2.3 and the Agreement highlights, which apply to every app. Assume the stricter rule, or ask developers@strava.com.

### Segments and leaderboards (API availability)

- The Segment Leaderboard endpoint was removed on 2020-06-18. [S9]
- Segment effort and leaderboard fields such as `kom_rank` are subscriber-only on `/segments/:id`, `/segment_efforts` and `/activities/:id`. [S9]
- The API reference marks `/segment_efforts` and `/segment_efforts/{id}` "Requires subscription". [S3]
- `DetailedSegment` has `athlete_count` and `effort_count`. It also has the Runner's own `athlete_pr_effort` / `athlete_segment_stats`. [S2]
- The official swagger has **no field giving the KOM/QOM time** on a Segment. [S2]
- **Explore Segments** is restricted to approved Extended Access Tier developers from 2026-09-01. It returns only the top 10 Segments per bounding box anyway. [S8, S3]

### AI/ML

- The Policy prohibits using Strava API Materials or Strava Data "directly or indirectly, in connection with the development, training, evaluation, or operation of any AI Application". [S7 §5.3]
- This explicitly includes "ingestion into a context window or working memory", embeddings and RAG. It also covers derived, aggregated or anonymised data. [S7 §5.3]
- Only the first-party Strava MCP is exempt. [S7 §3.5]
- Analytics on Strava Data are banned, even in aggregated or de-identified form. So is combining it with other customer data. [S7 §5.4]

### Consent, access and deletion

- Before collecting data, the app must disclose what it collects and how, and how to withdraw consent and request deletion. [S7 §2.1, §7.2]
- The app must confirm when a deletion is done. [S7 §2.1, §2.5]
- Users must be able to access the data collected about them. [S7 §2.2]
- On a user's request, deauthorization or account deletion, the app must permanently delete all of that user's Strava Data and derived Personal Data within **30 days**. [S7 §7.4]
- §2.5 says to delete "all Data about an end user" on request or cancellation, with written confirmation. [S7 §2.5]
- Deauthorization events arrive by webhook with `"authorized": "false"`. [S12]
- `POST /oauth/revoke` is the recommended revocation endpoint. `/oauth/deauthorize` will be removed on 2027-06-01. [S13]
- The app needs a GDPR/UK-GDPR compliant privacy policy. [S7 §7.3]
- Breaches must be reported to legal@strava.com within 24 hours. [S7 §8.3]
- On termination, all Strava Data must be deleted and the deletion certified. [S6 §4.4]

### Other constraints

- No apps that "compete with or replicate Strava functionality". [S6 highlights; S7 §5.2]
- No charging users for API-derived functionality. [S7 §5.8]
- Branding rules [S14; S7 §4.1]:
  - "Strava" must not appear in the app name or logo.
  - Links back to Strava use "View on Strava".
  - Interoperability is described only as "Powered by Strava" or "Compatible with Strava".
- The API base URL moves to `https://api-v3.strava.com`, available from 2027-01-04. [S8]

## Implications for myKOM

1. **Benchmarks:** use Strava's distance set minus 3K. Import means listing activities (200 per page), then one `GET /activities/{id}` per run. The lifetime best is the minimum elapsed time per distance.
2. **Onboarding needs a background import.** A 3,000-run Runner can take up to 2 days even at the 10-athlete tier. The import should:
   - process newest-first
   - report progress
   - respect the rate-limit headers and resume after a 429 or the daily reset
   - offer manual Benchmark entry so the Runner is not blocked
   Test the `achievement_count > 0` filter early; it may make imports far cheaper.
3. **Postgres design versus the 7-day cache rule.** Storing each Runner's lifetime best efforts, activities or Segment data indefinitely conflicts with §6.2, §5.5 and §6.4 as written.
   - Re-importing every 7 days is unaffordable.
   - A defensible design keeps only what the Runner **enters or confirms** as a Benchmark, which is arguably user data rather than Strava Data. Raw Strava Data would be a cache of 7 days at most.
   - Even confirmed values may count as data "derived from Strava Data". **This is an interpretation, not legal advice.** Consider asking developers@strava.com (the Agreement invites this [S6 §2.2]).
4. **Target Records, Held Segments and discovery need rethinking.** This reshapes the map.
   - The API exposes no KOM/QOM time.
   - Displaying another athlete's time or name is prohibited.
   - Explore Segments, the only documented way to find Segments near a Search Area, is Extended-tier only as of 2026-09-01.
   - Unless a ticket finds another compliant source, "rank Achievable Segments by Target Record in a Search Area" may be **infeasible through the official API**.
   - Scraping is explicitly banned [S7 §5.5].
5. **Held Segments:** the Runner's own `is_kom` / `kom_rank` fields on their efforts could mark a crown, but they are subscriber-only [S9]. `is_kom` also means the overall leaderboard, not the Runner's own-gender record [S2].
6. **Deletion and consent:**
   - Subscribe to the deauthorization webhook and delete within 30 days.
   - Reflect activity deletions within 48 hours.
   - Provide a data-access view, a privacy policy, and the consent disclosures.
7. **No AI features on Strava Data.** Keep any LLM out of the data path. That includes development workflows that paste real Runner data into an AI tool, since §5.3 covers "ingestion into a context window".
8. **Capacity:** the group is capped at 10 Runners on the self-service tier. The developer needs a Strava subscription, and Runners may need one if the Standard Tier requirements say so (unverified).

## Sources

- [S1] Strava Help Center, "How Do Best Efforts Work for Running on Strava?": https://support.strava.com/en-us/articles/15401661-best-efforts-running
- [S2] Official Strava swagger, https://developers.strava.com/swagger/swagger.json, and its models: https://developers.strava.com/swagger/activity.json, https://developers.strava.com/swagger/activity_stats.json, https://developers.strava.com/swagger/segment.json, https://developers.strava.com/swagger/segment_effort.json
- [S3] Strava API v3 reference: https://developers.strava.com/docs/reference/
- [S4] Strava rate limits: https://developers.strava.com/docs/rate-limits/
- [S5] Strava getting started: https://developers.strava.com/docs/getting-started/
- [S6] Strava API Agreement (2026, effective 2026-06-01): https://www.strava.com/legal/api
- [S7] Strava API Policy (2026, effective 2026-06-01): https://www.strava.com/legal/api_policy
- [S8] Strava V3 API changelog: https://developers.strava.com/docs/changelog/
- [S9] Changes to the Segments API (2020): https://developers.strava.com/docs/segment-changes/
- [S10] Strava Help Center, "Troubleshooting Best Efforts": https://support.strava.com/en-us/articles/15402001-troubleshooting-best-efforts
- [S11] Strava API docs, Pagination: https://developers.strava.com/docs/
- [S12] Strava webhooks: https://developers.strava.com/docs/webhooks/
- [S13] Strava authentication (deauthorization): https://developers.strava.com/docs/authentication/
- [S14] Strava API Brand Guidelines: https://developers.strava.com/guidelines/
