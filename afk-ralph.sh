#!/usr/bin/env bash
# AFK Ralph: loop non-interactive iterations until the PRD is complete or a limit is hit.
#
# Usage: ./afk-ralph.sh [--minutes N | --hours N] [--budget USD] [--iterations N] [--resume-after-limit]
#   --minutes / --hours    Don't start a new iteration after this much wall-clock time.
#                          A running iteration is allowed to finish, so its work is committed.
#   --budget USD           Stop once the reported cost of all iterations reaches this amount.
#                          Each iteration also gets --max-budget-usd set to what's left.
#   --iterations N         Hard cap on iterations (default 50), as a safety net.
#   --resume-after-limit   If an iteration hits the plan's usage limit, wait for the limit to
#                          reset and carry on instead of stopping. Waiting still respects
#                          --minutes/--hours; without a time limit it waits at most 12 hours.
# Progress streams live to the terminal (via ralph-stream.py): Claude's messages, each tool call,
# tool errors, plan usage, and a summary per iteration. The raw event stream for each iteration
# is saved under ralph-logs/.
# Safety: if an iteration reports paid overage (extra usage) in use, the loop stops.
set -euo pipefail
cd "$(dirname "$0")"

deadline=""
budget=""
max_iterations=50
resume_after_limit=false
max_wait_seconds=$((12 * 3600))
poll_seconds=${RALPH_POLL_SECONDS:-900} # how often to re-check when the reset time is unknown
reset_grace=${RALPH_RESET_GRACE:-60}    # extra seconds to wait after the reported reset time
while [[ $# -gt 0 ]]; do
  case "$1" in
    --minutes) deadline=$(( $(date +%s) + $2 * 60 )); shift 2 ;;
    --hours) deadline=$(( $(date +%s) + $2 * 3600 )); shift 2 ;;
    --budget) budget="$2"; shift 2 ;;
    --iterations) max_iterations="$2"; shift 2 ;;
    --resume-after-limit) resume_after_limit=true; shift ;;
    [0-9]*) max_iterations="$1"; shift ;; # backwards compatible: ./afk-ralph.sh 20
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
export PATH="$HOME/.local/bin:$PATH"
mkdir -p ralph-logs
spent="0"
waited=0

i=1
while ((i <= max_iterations)); do
  if [[ -n "$deadline" && $(date +%s) -ge $deadline ]]; then
    echo "=== Time limit reached; stopping before iteration $i ==="
    exit 1
  fi
  budget_args=()
  if [[ -n "$budget" ]]; then
    remaining=$(python3 -c "print(round($budget - $spent, 2))")
    if python3 -c "import sys; sys.exit(0 if $remaining <= 0 else 1)"; then
      echo "=== Budget of \$$budget reached (spent \$$spent); stopping before iteration $i ==="
      exit 1
    fi
    budget_args=(--max-budget-usd "$remaining")
  fi

  log="ralph-logs/$(date '+%Y%m%d-%H%M%S')-iter$i.jsonl"
  echo "=== Ralph iteration $i ($(date '+%H:%M:%S'), spent so far \$$spent) ==="
  # Stream events live: the raw JSON lines go to the log, a readable feed to the terminal.
  claude --permission-mode acceptEdits -p --output-format stream-json --verbose \
    ${budget_args[@]+"${budget_args[@]}"} \
    "@PRD.md @progress.txt $(cat ralph-prompt.md)" 2> "$log.stderr" \
    | tee "$log" | python3 ralph-stream.py || true

  # Parse the stream: cost, is_error, usage-limit flag, reset epoch (0 if unknown),
  # whether paid overage was used, and the final result text.
  read -r cost is_error hit_limit reset_at used_overage result < <(python3 - "$log" "$log.stderr" <<'PY'
import json, re, sys
raw = open(sys.argv[1]).read()
stderr = open(sys.argv[2]).read()
final, rate = None, {}
for line in raw.splitlines():
    try:
        event = json.loads(line)
    except ValueError:
        continue
    if event.get("type") == "result":
        final = event
    elif event.get("type") == "rate_limit_event":
        rate = event.get("rate_limit_info", {})
if final is not None:
    text, cost, err = final.get("result") or "", final.get("total_cost_usd", 0) or 0, bool(final.get("is_error"))
else:
    text, cost, err = raw, 0, True
if err:
    text = (text + " " + stderr).strip()
limited_by_event = bool(rate) and rate.get("status") not in (None, "allowed", "allowed_warning")
limit = err and (limited_by_event or re.search(r"usage limit|limit reached|rate limit|resets? ", text, re.I) is not None)
m = re.search(r"\|(\d{10})\b", text)  # e.g. "Claude AI usage limit reached|1790384089"
reset = int(rate.get("resetsAt") or 0) if limited_by_event else (int(m.group(1)) if m else 0)
overage = bool(rate.get("isUsingOverage"))
print(cost, str(err).lower(), str(limit).lower(), reset, str(overage).lower(), text.replace("\n", " ")[:2000] or "<empty>")
PY
)
  spent=$(python3 -c "print(round($spent + $cost, 4))")
  echo "--- iteration $i cost \$$cost; total \$$spent; log $log"

  if [[ "$used_overage" == "true" ]]; then
    echo "=== Paid overage (extra usage) was used in iteration $i; stopping so the loop never runs on paid usage ==="
    exit 1
  fi

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "=== PRD complete after $i iterations (\$$spent) ==="
    exit 0
  fi

  if [[ "$is_error" == "true" && "$hit_limit" == "true" && "$resume_after_limit" == "true" ]]; then
    now=$(date +%s)
    if ((reset_at > now)); then
      sleep_for=$((reset_at - now + reset_grace))
    else
      sleep_for=$poll_seconds # reset time unknown: check back periodically
    fi
    if [[ -n "$deadline" ]] && ((now + sleep_for >= deadline)); then
      echo "=== Usage limit hit; the limit resets after the time limit, so stopping ==="
      exit 1
    fi
    if [[ -z "$deadline" ]] && ((waited + sleep_for > max_wait_seconds)); then
      echo "=== Usage limit hit; already waited $((waited / 60)) min, stopping ==="
      exit 1
    fi
    echo "=== Usage limit hit; waiting $((sleep_for / 60)) min until $(date -r $((now + sleep_for)) '+%H:%M'), then retrying iteration $i ==="
    sleep "$sleep_for"
    waited=$((waited + sleep_for))
    continue # retry the same iteration number; the unfinished task is still unticked
  fi

  if [[ "$is_error" == "true" ]]; then
    echo "=== Iteration $i ended with an error (usage limit, budget cap or crash); stopping. See $log ==="
    exit 1
  fi
  i=$((i + 1))
done
echo "=== Stopped after $max_iterations iterations; PRD not complete (\$$spent) ==="
exit 1
