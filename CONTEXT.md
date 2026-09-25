# myKOM

Helps a runner find Strava segments near them whose record they could realistically take, given their current fitness.

## Language

### Runner and fitness

**Runner**:
A Strava athlete who has connected their account to myKOM. Running is the only sport in scope.
_Avoid_: User, athlete (when meaning the myKOM user)

**Benchmark**:
The Runner's time for one standard distance (the set Strava calculates best efforts for, e.g. 400m, 1k, 1 mile, 5k, 10k).
_Avoid_: PR, PB (those are per-Segment)

**Fitness Profile**:
The Runner's current set of Benchmarks. Defaults to lifetime best efforts from Strava; the Runner may override any Benchmark by their own judgement.
_Avoid_: Fitness score, current fitness

**Segment PB**:
The Runner's own fastest time on a particular Segment.

### Segments and ranking

**Segment**:
A Strava-defined stretch of route with its own leaderboard. Only running segments are relevant.

**Known Segment**:
A Segment the Runner has already run. The only Segments myKOM ranks.
_Avoid_: Nearby segment, local segment

**Target Record**:
The fastest time on a Segment within the Runner's own gender category (KOM for men, QOM for women): the time the Runner would need to beat.
_Avoid_: KOM (when gender-neutral), CR, course record

**Predicted Time**:
The time the Runner's Fitness Profile suggests they could run a given Segment in, accounting for its distance and elevation.

**Achievable**:
A Segment whose Predicted Time is within the Runner's chosen margin of its Target Record.

**Impressiveness**:
How much taking a Segment's Target Record means, measured by how many athletes have run the Segment.
_Avoid_: Popularity, score

**Implausible Record**:
A Target Record faster than is humanly credible for the Segment (e.g. GPS glitch, mislabelled ride). Flagged and demoted, not hidden.

**Held Segment**:
A Segment whose Target Record the Runner already holds. Shown with a crown, not excluded.

**Search Area**:
A centre point (from a place name, postcode, or the Runner's location) plus a radius chosen from a fixed set. It narrows the Runner's Known Segments; it does not find new ones.
