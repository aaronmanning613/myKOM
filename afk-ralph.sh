#!/usr/bin/env bash
# AFK Ralph: loop non-interactive iterations until the PRD is complete or a limit is hit.
#
# Usage: ./afk-ralph.sh [--minutes N | --hours N] [--budget USD] [--iterations N]
#   --minutes / --hours  Don't start a new iteration after this much wall-clock time.
#                        A running iteration is allowed to finish, so its work is committed.
#   --budget USD         Stop once the reported cost of all iterations reaches this amount.
#                        Each iteration also gets --max-budget-usd set to what's left.
#   --iterations N       Hard cap on iterations (default 50), as a safety net.
# At least one of --minutes/--hours/--budget/--iterations should be given.
# Per-iteration output is saved under ralph-logs/.
set -euo pipefail
cd "$(dirname "$0")"

deadline=""
budget=""
max_iterations=50
while [[ $# -gt 0 ]]; do
  case "$1" in
    --minutes) deadline=$(( $(date +%s) + $2 * 60 )); shift 2 ;;
    --hours) deadline=$(( $(date +%s) + $2 * 3600 )); shift 2 ;;
    --budget) budget="$2"; shift 2 ;;
    --iterations) max_iterations="$2"; shift 2 ;;
    [0-9]*) max_iterations="$1"; shift ;; # backwards compatible: ./afk-ralph.sh 20
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
export PATH="$HOME/.local/bin:$PATH"
mkdir -p ralph-logs
spent="0"

for ((i = 1; i <= max_iterations; i++)); do
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

  log="ralph-logs/$(date '+%Y%m%d-%H%M%S')-iter$i.json"
  echo "=== Ralph iteration $i ($(date '+%H:%M:%S'), spent so far \$$spent) ==="
  claude --permission-mode acceptEdits -p --output-format json ${budget_args[@]+"${budget_args[@]}"} \
    "@PRD.md @progress.txt $(cat ralph-prompt.md)" > "$log" || true

  read -r cost is_error result < <(python3 - "$log" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print("0 true <no JSON output; see log>"); sys.exit()
text = (d.get("result") or "").replace("\n", " ")
print(d.get("total_cost_usd", 0), str(d.get("is_error", False)).lower(), text)
PY
)
  spent=$(python3 -c "print(round($spent + $cost, 4))")
  echo "$result"
  echo "--- iteration $i cost \$$cost; total \$$spent; log $log"

  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "=== PRD complete after $i iterations (\$$spent) ==="
    exit 0
  fi
  if [[ "$is_error" == "true" ]]; then
    echo "=== Iteration $i ended with an error (usage limit, budget cap or crash); stopping. See $log ==="
    exit 1
  fi
done
echo "=== Stopped after $max_iterations iterations; PRD not complete (\$$spent) ==="
exit 1
