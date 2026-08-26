# v1.0 Stage 3 — Codex-style Editing

Stage 3 builds on Trusted Workspace + Trusted Terminal Runtime and adds a recoverable coding work unit.

## MCP primitives

- `start_work(project, goal)` — baseline Git state + Brain summary and a work session id.
- `apply_patch(project, patch, work_session_id?)` — standard unified diff, multi-file, preflight before mutation.
- `work_status(work_session_id)` — changed files, command history, recovery points and current Git diff/status.
- `finish_work(work_session_id, verify_commands?)` — optional verification, Brain refresh and final Git state.
- `rollback_work(work_session_id)` — reverse all session mutations and refresh Brain.

Total MCP tools after Stage 3: **29**. Legacy tools remain compatible.

## Editing guarantees

- Unified diff supports modify/create/delete across multiple text files.
- Existing line endings are preserved when patching existing files.
- All hunks are preflighted before the first mutation.
- If a later mutation fails, already-applied files are automatically restored.
- Normal ChatCode safety, secret and project-boundary rules remain in force.
- Existing files still get Recovery Snapshot ids when global recovery is enabled.
- Work sessions also retain an in-memory before-state so `rollback_work` can restore session changes when global Recovery Snapshot is disabled.
- Project index + Brain are refreshed after apply/finish/rollback.
- `exec(..., work_session_id)` links Trusted terminal commands to the coding session.
- Git push remains unavailable.

## Windows CI acceptance

1. Syntax checks include `core/work-runtime.js` and `renderer/v10-stage3.js`.
2. MCP smoke reports exactly 29 tools and exercises all five Stage 3 tools.
3. Stage 3 smoke creates a temp Git repository and tests a multi-file patch: CRLF modify + create + delete.
4. New symbols must be searchable by Project Brain immediately after `apply_patch`.
5. Work status must show changed files, linked terminal command and Git diff.
6. `finish_work` verification command must pass through the hidden Trusted terminal runtime.
7. `rollback_work` must restore the original Git-clean tree.
8. With global Recovery Snapshot disabled, work-session rollback must still restore modified files and remove session-created files.
9. A hunk conflict must fail before mutation.
10. All earlier Safety, Trusted Workspace, Terminal, Brain, WordPress, fast-path, Windows task, Support, updater, installer and tunnel tests must remain green.
