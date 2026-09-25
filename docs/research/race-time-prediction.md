# Race-time prediction models for Segments

Research for [issue #5](https://github.com/aaronmanning613/myKOM/issues/5) (map: [#1](https://github.com/aaronmanning613/myKOM/issues/1)).

**Question.** Which models can turn a Runner's Benchmarks (best times at roughly 400 m, 1 km, 1 mile, 2 miles, 5 km and 10 km) into a Predicted Time for a Segment of a given distance and elevation profile? How accurate are they over 100 m to 2 km, and what inputs does each need?

**Short answer.** No published model is validated for this exact job. The distance models (Riegel, Daniels VDOT, critical speed) were built and checked on efforts of roughly 3.5 minutes or longer. The grade models (Minetti, Strava GAP) were built on steady, mostly aerobic running. Most Segments are 100 m to 2 km, which for most Runners is under about 8 minutes, so they fall at or below the lower edge of what these models cover. The most defensible option for myKOM is to interpolate between the Runner's own Benchmarks. The Fitness Profile already covers 400 m to 10 km, so a Segment of 400 m or more almost always falls between two Benchmarks and needs no extrapolation. Grade is then handled by converting the Segment to an equivalent flat distance with a GAP-style curve. Anything under 400 m is extrapolation and should be treated as low confidence.

Tags: **[primary]** means read in the original paper or official doc. **[secondary]** means the primary was not reachable and the claim is taken from a faithful reproduction. **[unverified]** means I could not confirm it against any source I could open.

---

## 1. Inputs available

| Input | Source | Notes |
|---|---|---|
| Benchmarks (time at a standard distance) | Fitness Profile | At most one per standard distance. The shortest Strava best effort is 400 m (covered by the separate best-efforts ticket). |
| Segment `distance`, `average_grade`, `maximum_grade`, `elevation_high`, `elevation_low` | `SummarySegment` | [primary] [Strava swagger `segment.json`](https://developers.strava.com/swagger/segment.json) |
| `total_elevation_gain`, `map.polyline` | `DetailedSegment` only | [primary] same file. |
| Per-point `distance`, `altitude`, `latlng` | `GET /segments/{id}/streams` | [primary] [Strava swagger](https://developers.strava.com/swagger/swagger.json). The `keys` enum for segment streams is exactly `distance`, `latlng`, `altitude`. There is no `grade_smooth` for segments, so grade has to be derived from altitude over distance. Costs one API call per Segment. |

Without streams, a Segment's elevation profile is summarised by five numbers: distance, average grade, maximum grade, net elevation (`elevation_high − elevation_low`) and, on the detailed object, total elevation gain. Comparing `total_elevation_gain` with net elevation shows whether a Segment is a steady climb or rolling (see §4.4).

---

## 2. Distance scaling (flat)

### 2.1 Riegel power law

**Formula.** `t2 = t1 · (d2 / d1)^b`, with `b ≈ 1.06` for running. Riegel wrote it as `t = a·x^b` fitted to world records.
- Source: Riegel, P. S. (1981) "Athletic Records and Human Endurance", *American Scientist* 69(3):285–290. The PDF copies I found returned 403, so the content comes from the [Wikipedia summary with citation](https://en.wikipedia.org/wiki/Peter_Riegel) [secondary] and from Blythe & Király (below), who cite Riegel's values as 1.08 for elite athletes and 1.06 for senior athletes [secondary].
- **Valid range:** Riegel limited the equation to the "endurance range" of **3.5 to 230 minutes** [secondary, via Wikipedia's citation of the 1981 paper]. A 400 m or 1 km effort is below that range for almost everyone, and a 1 mile effort is below it for fast Runners.
- **Individual variation:** fitting a power law to each athlete in the UK athletics database gave a median individual exponent of **1.12** (5th to 95th percentile 1.10 to 1.15), which is higher than Riegel's world-record 1.06 [primary: [Blythe & Király 2015, arXiv:1505.01147](https://arxiv.org/abs/1505.01147), §IV.iii]. The same paper shows individual performance curves are not straight lines in log-log space, and finds a **"phase transition around 800 m"** [primary, §V]. A fixed 1.06 exponent is therefore a population average that does not describe any individual well, especially across 800 m.
- **Accuracy:** in the same study, low-rank matrix completion beat Riegel's fixed exponent and a per-athlete fitted power law (p ≤ 1e-4), with RMSE improvement "over 50%" for the fastest quartile [primary]. The gains were largest for short and middle distances: 26.3% for 100 m and 200 m, and 29.3% for 400 m to 1500 m, compared with 3.1% for the marathon [primary]. Individual variability is highest exactly where Segments are.
- **Inputs:** one Benchmark (fixed `b`), or two or more to fit `b` per Runner.

### 2.2 Daniels & Gilbert VDOT

**Formulas** (v in m/min, t in min):
- Oxygen cost of running: `VO2(v) = −4.60 + 0.182258·v + 0.000104·v²`
- Fraction of VO2max sustainable for t minutes: `%max(t) = 0.8 + 0.1894393·e^(−0.012778·t) + 0.2989558·e^(−0.1932605·t)`
- `VDOT = VO2(d/t) / %max(t)`. To predict a time for another distance, solve for `t` such that `VO2(d/t)/%max(t) = VDOT`.
- Source: Daniels, J. & Gilbert, J. (1979) *Oxygen Power: Performance Tables for Distance Runners*, and Daniels' *Running Formula*. I could not reach the book. The equations above come from the transcription in [mekeetsa/vdot `vdot-theory.pdf`](https://github.com/mekeetsa/vdot) [secondary], and the description of the two regressions is confirmed by [this Oxygen Power summary](http://www.simpsonassociatesinc.com/oxypwr.html) [secondary].
- **Short-distance behaviour:** `%max(t)` exceeds 1.0 for t below roughly 10 minutes. It reaches about 1.13 at 3.5 minutes and about 1.22 at 1.2 minutes (my computation from the formula), which stands in for the anaerobic contribution. The model has no concept of a Runner's sprint speed. It is a one-parameter model, so every Runner with the same VDOT gets the same predicted 400 m, whatever their speed profile. Which distance range the published tables cover (they are thought to start around 1500 m) is **[unverified]**.
- **Inputs:** one Benchmark, or several averaged.

### 2.3 Critical speed (CS) and D′

**Formulas** (two-parameter; D and D′ in m, CS in m/s, t in s):
- `D = CS·t + D′`, so `t = (D − D′)/CS`, and speed `S = D′/t + CS`
- Source: [primary] [Pettitt (2016) "Applying the Critical Speed Concept to Racing Strategy…", *IJSPP* 11:842–847](https://paulogentil.com/pdf/Applying%20the%20Critical%20Speed%20Concept%20to%20Racing%20Strategy%20and%20Interval%20Training%20Prescription.pdf), Eq 1–3. The paper states that CS and D′ are commonly derived "from PR times of different distances". Its worked example is Prefontaine, with CS = 6.0 m/s and D′ = 200 m.
- **Three-parameter (Morton) variant** adds a maximal speed `S_max` so that the curve does not go to infinity at short durations: `t = D′/(S − CS) − D′/(S_max − CS)` [primary: [Vandewalle 2018, *BioMed Res Int*, Eq 15](https://europepmc.org/article/PMC/PMC6192093)].
- **Valid range:** CS studies typically use exhaustion times of about **3 to 15 minutes**, which corresponds to 1500 m to 5000 m for elite runners [primary: Vandewalle 2018]. The CP literature describes the model as holding for roughly 2 to 15–30 minutes [secondary: [PMC10988433](https://pmc.ncbi.nlm.nih.gov/articles/PMC10988433/) as summarised].
- **Accuracy:** for six elite runners over 1500 m to 10000 m, the two-parameter models were the least accurate, with errors "< 2% except for 1500 m". Morton's three-parameter model was the most accurate, at under 0.5% for every distance from 1500 m to 10000 m [primary: Vandewalle 2018]. Every asymptotic model over-predicts long distances.
- **Short-distance failure:** the two-parameter model breaks down badly below about 2 minutes. In the worked example in §2.5 it predicts a 200 m in 3.7 s, because once `D ≲ D′` the predicted time tends to zero.
- **Inputs:** at least 2 Benchmarks for the two-parameter model, at least 3 for Morton, ideally all within about 2 to 15 minutes.

### 2.4 Sprint-range model: anaerobic speed reserve (Bundle et al. 2003)

- **Idea:** all-out speed for a few seconds up to 4 minutes decays exponentially from the Runner's top sprint speed (`S_an`) towards their speed at VO2max (`S_aer`). The form is `S(t) = S_aer + (S_an − S_aer)·e^(−k·t)` with a single constant `k` shared across runners.
- Source: Bundle, Hoyt & Weyand (2003) "High-speed running performance: a new approach to assessment and prediction", *J Appl Physiol* 95:1955–62 [primary, abstract only via [Europe PMC / PubMed 14555668](https://europepmc.org/article/MED/14555668)]. The abstract reports a trial range of **3 to 240 s**, prediction of all-out treadmill speeds to within 2.5% on average (R² = 0.94) and track trials to within 3.4% (R² = 0.86). Using the exponent plus only two all-out runs gave 3.7% accuracy.
- The exact equation form and the value `k ≈ 0.013 s⁻¹` are **[unverified]** (full text returned 403).
- **Relevance:** this is the only model I found that is validated for 3 to 240 s efforts, which is exactly the 100 m to 1 km Segment range. It needs `S_an` (top sprint speed over about 3 s), and myKOM cannot get that from Strava best efforts. It could be approximated by fitting to the 400 m and 1 km Benchmarks, or entered by the Runner.

### 2.5 Worked comparison (illustrative, my computation)

Hypothetical Runner: 400 m 1:15, 1 km 3:30, mile 5:50, 2 mile 12:20, 5 km 20:00, 10 km 42:00. That gives VDOT ≈ 49.8, CS ≈ 4.04 m/s, D′ ≈ 185 m (fitted on 1 km to 5 km), and an individual exponent of 1.083 from 1 km to 5 km. Times in seconds:

| Distance | Riegel from nearest Benchmark | Riegel from 5 km | VDOT (from 5 km) | CS 2-param |
|---|---|---|---|---|
| 100 m | 17.3 | 19.0 | 19.0 | undefined |
| 200 m | 36.0 | 39.6 | 38.5 | 3.7 (broken) |
| 400 m (actual 75.0) | 75.0 | 82.5 | 78.7 | 53.3 |
| 800 m | 165.8 | 172.0 | 163.8 | 152.4 |
| 1500 m | 324.8 | 334.9 | 324.8 | 325.9 |
| 2000 m | 440.7 | 454.3 | 446.0 | 449.8 |

From about 1500 m up, all the methods agree to within about 3%. Below 800 m they diverge. Methods anchored on a long Benchmark (5 km) are 5–10% too slow at 400 m for this Runner, and CS breaks down. Anchoring on the nearest Benchmark keeps the Runner's own speed profile.

---

## 3. Grade adjustment

### 3.1 Minetti et al. (2002): metabolic cost of running on slopes

- **Formula** (gradient `i` as a fraction, cost in J·kg⁻¹·m⁻¹): `Cr(i) = 155.4·i⁵ − 30.4·i⁴ − 43.3·i³ + 46.3·i² + 19.5·i + 3.6`, R² = 0.999, fitted over −0.45 ≤ i ≤ +0.45 [primary: [Minetti et al., *J Appl Physiol* 93:1039–1046](https://www.skyrunning.com/wp-content/uploads/2020/05/Scientific-Research.pdf), Fig 1 legend].
- **Measured values:** level Cr = 3.40 ± 0.24, "independent of speed". The minimum is 1.73 at −0.20 and the maximum 18.93 at +0.45 [primary, abstract and Table 2]. Subjects were 10 runners on a treadmill.
- **As a pace factor:** `f(i) = Cr(i)/Cr(0)`. My computation gives 0.76 at −5%, 0.60 at −10%, 0.50 at −20%, 1.30 at +5%, 1.66 at +10% and 2.50 at +20%. Converting cost to speed as `v = Ė/Cr` assumes the metabolic power available is the same on any slope [primary, Eq 3–4].
- **Minetti's own validation:** the model predicted uphill race vertical speed well (ratio of predicted to actual 0.950 ± 0.130). It **overestimated downhill race speed by about 3×** (3.446 ± 1.324), and the authors conclude runners "do not seem to use the full amount of the available aerobic power" downhill [primary, Discussion]. **Raw Minetti should not be used for descents.**

### 3.2 Strava Grade Adjusted Pace (GAP)

- **Current model** (2017 onwards): built from the heart rate of real runs, not from metabolic cost. For each athlete, runs are cut into 2-minute windows. The system keeps windows whose mean heart rate falls in that athlete's **70th to 90th percentile**, normalises pace to the athlete's median pace near 0% grade, and takes the median normalised pace per grade bin as the GAP coefficient (1.0 on the flat) [primary: [US 11,623,121 B1, "Using aggregate activity data to generate a grade adjusted pace model", Strava / D. Robb](https://patents.google.com/patent/US11623121)].
- **Shape:** "the downhill adjustment peaks around −10%, after which it becomes slightly less extreme". GAP "does not account for the technical difficulty or condition of the terrain" [primary: [Strava Help Center](https://support.strava.com/en-us/articles/15402117-grade-adjusted-pace-gap)]. Drew Robb's engineering post reports that the old (Minetti-based) model had its minimum adjustment of about 0.5 at −18%, while the new one has a minimum of **about 0.88 at −9%** and returns to about 1.0 at −18%. It was trained on about 6 million runs from 240,000 athletes. The primary source is the [Strava Engineering Medium post](https://medium.com/strava-engineering/an-improved-gap-model-8b07ae8886c3), which returned 403. These numbers come from search-result excerpts and [a secondary write-up](https://educatedguesswork.org/posts/grade-vs-pace/) [secondary].
- **The curve itself is not published.** No coefficient table or formula appears in the patent summary or the help article. [One reverse-engineering effort](https://aaron-schroeder.github.io/reverse-engineering/grade-adjusted-pace.html) fits a 5th-order polynomial to exported GAP data but does not print the coefficients [secondary]. myKOM would have to approximate the curve. A GAP value computed by Strava for arbitrary Segments is not available from the API [unverified: I found nothing in the swagger].
- **Caveat for this use:** GAP is calibrated at the heart rates of hard training (70th to 90th percentile, 2-minute windows), not at all-out effort. Whether the ratios hold at all-out 400 m pace is **[unverified]**. The anaerobic share is higher at that pace, and on a short steep descent leg speed and control, not energy, limit speed.

### 3.3 Other published fit (for reference)

- Ultrapacer: `factor = 0.0021·g² + 0.034·g + 1`, with g in %, between −22% and +16%. The source of the model is unknown [secondary: [educatedguesswork.org](https://educatedguesswork.org/posts/grade-vs-pace/)]. That author's own data was "generally flatter" than Minetti, Strava and Ultrapacer, with slower descents and faster climbs than all three predicted [secondary].

---

## 4. Combining distance and grade

### 4.1 Equivalent flat distance

Given a pace factor `f(g)` per segment slice of length `dᵢ` and grade `gᵢ`:

```
D_eq = Σ dᵢ · f(gᵢ)
Predicted Time = T_flat(D_eq)
```

Here `T_flat(D)` is the distance model from §2. This is consistent because time on a slice is `dᵢ·f(gᵢ)/v`, where `v` is the flat speed the Runner can hold for the effort's total duration. That duration is the same as the flat time for `D_eq`, so no iteration is needed. It assumes pace factors do not depend on intensity (see the §3.2 caveat).

### 4.2 Using only average grade (no streams)

`D_eq ≈ distance · f(average_grade)`. This is cheap and needs no extra API call.

### 4.3 Using altitude streams

Resample the `distance` and `altitude` streams into bins of about 10 to 50 m, compute grade per bin, and sum as in §4.1. Smooth the altitude first, because GPS and barometric altitude noise creates false grades on short bins [unverified as a quantified claim; standard practice]. This costs one call per Segment, so it may suit only the shortlist near the Achievable margin.

### 4.4 Why average grade is biased for rolling Segments

`f` is convex (Minetti's curve), so `f(average grade) ≤ average of f`. Example (my computation with Minetti): half at +8% and half at −8% gives a factor of 1.08, but the average grade of 0% gives 1.00. Strava's flatter downhill curve makes the gap larger, because descents return less of the time lost on climbs. Comparing `total_elevation_gain` with `elevation_high − elevation_low` flags such Segments. If gain is much larger than net elevation, the Segment is rolling and average grade under-predicts its time.

---

## 5. Accuracy at 100 m to 2 km

| Range | What the literature supports |
|---|---|
| 1.5 km to 2 km (about 4 to 8 min) | All the distance models are close to their validated range. Interpolating between the mile and 2 mile Benchmarks is reliable. Morton-CS is under 0.5% for elites at 1500 m [Vandewalle]. Expect a few % error for normal Runners [unverified magnitude]. |
| 400 m to 1.5 km (about 1 to 5 min) | Below Riegel's and CS's ranges. Individual variation is largest here (29% gain from a better model at 400 m to 1500 m) [Blythe & Király]. The 800 m "phase transition" means one exponent across it misleads. Interpolating between the 400 m, 1 km and mile Benchmarks is the safest choice. Bundle's ASR model is validated here, to within about 3.4% on the track. |
| Under 400 m (sprints) | No Benchmark lies below 400 m, so every method extrapolates. Performance depends on top speed, which endurance Benchmarks barely constrain. Blythe & Király show that sprint performance loads on a different component than the endurance exponent. Treat these predictions as low confidence. |
| Grade on any short Segment | Minetti is steady-state and aerobic, and overestimates downhill speed about 3×. Strava GAP is calibrated at submaximal heart rate over 2-minute windows. Neither has been validated at all-out short-effort intensity [unverified]. |

A second practical problem at short distances is GPS error. A 100 m to 300 m Segment has timing noise of a second or more, which is several percent of the total [unverified magnitude]. This is linked to the Implausible Record ticket.

---

## 6. Implications for myKOM

The decision itself belongs to the later grilling ticket. Recommended candidate:

1. **Flat model: piecewise log-log interpolation of the Runner's own Benchmarks** (a "local Riegel"). Between adjacent Benchmarks `(d₁,t₁)` and `(d₂,t₂)`, use `b = ln(t₂/t₁)/ln(d₂/d₁)` and `t = t₁·(d/d₁)^b`. It reproduces the Benchmarks exactly, respects the Runner's own speed profile across the 800 m transition, needs no fitted physiology, and works with whatever subset of Benchmarks exists.
   - **Above 10 km:** extrapolate with the last segment's exponent, or with 1.06 as a floor. This is rarely needed for Segments.
   - **Below 400 m:** extrapolate from 400 m with the 400 m–1 km exponent, clamped to a sane range. My suggestion is `b` between 1.00 and 1.10 [unverified], but this is a judgement call for the grilling ticket. Label the result **low confidence** in the UI.
   - **Missing Benchmarks:** fall back to single-anchor Riegel (1.06) from the nearest Benchmark.
   - **Alternatives:** Morton's three-parameter CS model is more principled and was the most accurate in Vandewalle, but it needs at least 3 Benchmarks in the 2 to 15 min band and still extrapolates poorly below about 1 min. VDOT is simple but one-dimensional, so it discards the Runner's speed profile.
2. **Grade: equivalent flat distance** `D_eq = Σ dᵢ·f(gᵢ)`, with `f` shaped like Strava's GAP curve. Use Minetti's ratio for climbs. For descents, cap the benefit to a minimum of about 0.88 near −9%, returning towards 1.0 by about −18%, following Strava's published shape. There is no published formula, so myKOM would own this curve.
3. **Profile resolution:** start with `average_grade` from the list or explore data. Flag rolling Segments with `total_elevation_gain` compared with net elevation, and fetch `altitude` streams only for Segments whose average-grade prediction lands near the Achievable margin. That keeps API calls down.
4. **Keep the model behind a seam** (`predictTime(fitnessProfile, segmentProfile)`), so the Runner-set Achievable margin can absorb model error and a better model can replace this one without changes elsewhere.
5. **Validation opportunity:** myKOM holds the Runner's own Segment PBs, and those are real all-out efforts on real profiles. Comparing Predicted Time with Segment PB, given the Runner's Benchmarks, would calibrate the grade curve and the sub-400 m exponent per Runner. This could become a later refinement.

### Things that may reshape the map
- Nothing in the literature is validated for all-out efforts under 400 m. Sub-400 m Segments probably need explicit handling, such as a confidence flag or exclusion, in the ranking or presentation ticket.
- The segment streams endpoint provides altitude, so accurate grade handling costs one API call per Segment. That interacts with rate-limit budgeting in the Segment data and discovery work.
- The Strava swagger describes `GET /segments/explore` as "Available only to Extended Access Tier apps with granted permission" [primary: [swagger.json](https://developers.strava.com/swagger/swagger.json)]. That matters for Segment discovery and may already be covered by the segment-discovery research.
