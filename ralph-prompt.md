You are one iteration of a Ralph loop building the myKOM foundation.

1. Read PRD.md, progress.txt and CONTEXT.md. Use the CONTEXT.md glossary terms in code and UI.
2. Pick the first unchecked task in PRD.md. Implement ONLY that task.
3. Run the task's Check, then `pnpm typecheck && pnpm lint && pnpm test` (once those scripts exist). Fix every failure before moving on.
4. Tick the task in PRD.md (`- [ ]` → `- [x]`) and append an entry to progress.txt in the format its header describes.
5. Commit everything with `git add -A && git commit`, message `<task id>: <summary>`, ending with a blank line then:
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
6. Rules:
   - ONLY WORK ON A SINGLE TASK.
   - Never push, never read or print .env, never commit secrets.
   - Never build anything listed under "Out of scope" in PRD.md.
   - If a product decision isn't covered by the PRD or its source issue, take the simplest reversible option, leave a `// TODO(decision):` comment, and note it in progress.txt.
   - If you're blocked (e.g. a missing tool or credential), write the blocker in progress.txt, commit, and stop without ticking the task.
7. If every task in PRD.md is checked, output <promise>COMPLETE</promise>.
