# myKOM

Helps a runner find Strava segments near them whose record they could realistically take, given their current fitness.

## Language

### Runner and fitness

**Runner**:
A Strava athlete who has connected their account to myKOM. Running is the only sport in scope.
_Avoid_: User, athlete (when meaning the myKOM user)

**Benchmark**:
The Runner's time for one standard distance, from a fixed set running from 400m to the marathon.
_Avoid_: PR, PB (those are per-Segment)

**Fitness Profile**:
The Runner's current set of Benchmarks. Generated from the Runner's best recent race-like runs (the last 3 years) when they connect; later changes are only suggested, and the Runner applies them. The Runner may override any Benchmark by their own judgement.
_Avoid_: Fitness score, current fitness

**Segment PB**:
The Runner's own fastest time on a particular Segment.

### Segments and ranking

**Segment**:
A Strava-defined stretch of route with its own leaderboard. Only running segments are relevant.

**Known Segment**:
A Segment the Runner has already run or has starred on Strava. The only Segments myKOM ranks.
_Avoid_: Nearby segment, local segment

**Target Record**:
The fastest time on a Segment within the Runner's own gender category (KOM for men, QOM for women): the time the Runner would need to beat.
_Avoid_: KOM (when gender-neutral), CR, course record

**Predicted Time**:
The time the Runner's Fitness Profile suggests they could run a given Segment in, accounting for its distance and elevation.

**Prediction Confidence**:
How far to trust a Predicted Time: high or low. Low when the prediction stretches beyond what the Fitness Profile or the Segment's data can support; high when the Runner's Segment PB backs it.

**Achievable**:
A Segment whose Predicted Time is within a fixed margin of its Target Record. The margin is not a Runner setting.

**Nearest Miss**:
A Segment that is not Achievable but is among the closest to it, shown when the Runner has few Achievable Segments.

**Impressiveness**:
How much taking a Segment's Target Record means, measured by how many athletes have run the Segment.
_Avoid_: Popularity, score

**Implausible Record**:
A Target Record faster than is humanly credible for the Segment (e.g. GPS glitch, mislabelled ride). Flagged and demoted, not hidden.

**Held Segment**:
A Segment whose Target Record the Runner already holds. Shown with a crown, not excluded.

**Search Area**:
A centre point (from a place name, postcode, or the Runner's location) plus a radius chosen from a fixed set. It narrows the Runner's Known Segments; it does not find new ones.

**Mapped Area**:
A large area (such as a whole city) the Runner has asked myKOM to fill in gradually in the background, so its Known Segments are ready before any Search Area inside it is searched.
