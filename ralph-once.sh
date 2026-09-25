#!/usr/bin/env bash
# Human-in-the-loop Ralph: one iteration, interactive, so you can watch it.
set -euo pipefail
cd "$(dirname "$0")"
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 22 >/dev/null
export PATH="$HOME/.local/bin:$PATH"

claude --permission-mode acceptEdits "@PRD.md @progress.txt $(cat ralph-prompt.md)"
