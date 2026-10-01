You are one iteration of a Ralph loop building myKOM (see PRD.md for the current phase).

1. Read PRD.md, progress.txt and CONTEXT.md. Use the CONTEXT.md glossary terms in code and UI. PRD.md names a source spec (a GitHub issue); read the spec section your task names with `gh issue view <n>` before starting.
2. Run `git status`. Ignore uncommitted changes to CONTEXT.md: the Runner edits it by hand and it isn't yours to commit or change. If there are other uncommitted changes, a previous iteration was interrupted (e.g. by a usage limit) partway through the first unchecked task: review those changes, keep what's sound, and finish that task. Don't start over or discard them. Otherwise, pick the first unchecked task in PRD.md. Either way, work on ONLY that task.
3. Run the task's Check, then `pnpm typecheck && pnpm lint && pnpm test && pnpm test:e2e`. If the task touches UI, also follow PRD.md's "UI verification" convention: run the app and click through it with the Playwright MCP browser tools. Fix every failure before moving on.
4. Tick the task in PRD.md (`- [ ]` → `- [x]`) and append an entry to progress.txt in the format its header describes.
5. Stage the files this task changed (`git add <paths>`, never `git add -A`, and never CONTEXT.md unless the task itself required a glossary change) and commit, message `<task id>: <summary>`, ending with a blank line then:
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
6. Rules:
   - ONLY WORK ON A SINGLE TASK.
   - Never push, never read or print .env, never commit secrets.
   - Never build anything listed under "Out of scope" in PRD.md.
   - If a product decision isn't covered by the PRD or its source issue, take the simplest reversible option, leave a `// TODO(decision):` comment, and note it in progress.txt.
   - If you're blocked by something only a human can fix (e.g. a command that needs approval, a missing tool or credential), write the blocker and exactly what the human should do in progress.txt, commit it, don't tick the task, and end your reply with <blocked>. The loop stops on that marker so a human can act. If progress.txt reports an earlier block, try the blocked step once (the human may have fixed it); if it fails the same way, stop and output <blocked> rather than working around it.
7. If every task in PRD.md is checked, output <promise>COMPLETE</promise>.
