#!/usr/bin/env bash
# AFK Ralph: loop up to N non-interactive iterations; stop when the PRD is complete.
# Usage: ./afk-ralph.sh <iterations>
set -euo pipefail
cd "$(dirname "$0")"
iterations="${1:?usage: ./afk-ralph.sh <iterations>}"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
export PATH="$HOME/.local/bin:$PATH"

for ((i = 1; i <= iterations; i++)); do
  echo "=== Ralph iteration $i/$iterations ($(date '+%H:%M:%S')) ==="
  result=$(claude --permission-mode acceptEdits -p "@PRD.md @progress.txt $(cat ralph-prompt.md)")
  echo "$result"
  if [[ "$result" == *"<promise>COMPLETE</promise>"* ]]; then
    echo "=== PRD complete after $i iterations ==="
    exit 0
  fi
done
echo "=== Stopped after $iterations iterations; PRD not complete ==="
exit 1
