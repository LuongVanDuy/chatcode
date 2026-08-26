# v1.0 Stage 4 — Fast Agent Path

Stage 4 is the final v1.0 roadmap stage. ChatGPT remains the coding agent; ChatCode reduces MCP round-trips by composing Project Brain, Work Session, Unified Patch, Trusted Terminal and Git inspection into a two-call default path.

## Preferred MCP flow

1. `prepare_task(project, request)`
   - opens a Work Session;
   - returns `task_id` / `work_session_id`;
   - returns ranked relevant file contents, framework/WordPress context, symbols/relations and Git baseline;
   - returns verification hints derived from the project.
2. ChatGPT creates a standard unified diff from that packet.
3. `complete_task(task_id, patch, verify_commands)`
   - applies the patch transactionally through Stage 3;
   - runs verification through Trusted Terminal or Safe `run_task` as appropriate;
   - refreshes Project Brain and Git state;
   - finalizes the Work Session when verification passes.

Normal task target: **2 MCP calls**.

If verification fails, `complete_task` returns `status: "needs_fix"` and leaves the Work Session active. ChatGPT should generate a corrective unified diff against the current files and call `complete_task` again with the same `task_id`. This keeps repair tasks within roughly 3–4 MCP calls instead of restarting discovery.

## Safety and recovery

- `prepare_task` is read/context work plus an in-memory Work Session.
- All mutations still go through Stage 3 `apply_patch` and existing project boundary / secret / permission rules.
- Unified diff preflight and automatic partial-mutation rollback remain active.
- Recovery Snapshot behavior is unchanged.
- `rollback_work(task_id)` can abandon the whole Fast Agent task and restore its baseline.
- `rollback_on_failure:true` may be used with `complete_task` to restore the task immediately when verification fails.
- Git push and `reset --hard` remain blocked.

## MCP compatibility

Stage 4 adds two tools:

- `prepare_task`
- `complete_task`

Total MCP tools in v1.0: **31**. All previous 29 tools remain available.

## Windows CI acceptance

1. MCP server reports version `1.0.0` and exactly 31 tools.
2. `prepare_task` returns source content, Brain/framework context, Git baseline, verification hints and a task id.
3. A normal task completes through `prepare_task → complete_task` and records the two-call contract.
4. Verification failure returns `needs_fix` while `work_status` remains `active`.
5. A corrective `complete_task` on the same task id can pass and finish the task.
6. Verification commands remain linked to the Work Session command history.
7. `rollback_work` after multiple edits to the same file restores the original Git-clean baseline.
8. `rollback_on_failure:true` restores baseline immediately after failed verification.
9. Existing Stage 1–3, Brain, WordPress, Safe/Trusted, Windows task, updater, installer and remote tunnel tests remain green.
