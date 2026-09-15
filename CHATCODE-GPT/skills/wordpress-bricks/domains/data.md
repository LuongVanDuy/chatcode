# Data and migration domain

Use for seed/import, persisted Builder/content upgrades, database transformations and cleanup that changes stored state.

## Procedure

1. Distinguish initial setup from migration. New layout/template code is not a migration merely because it creates content once.
2. Persisted changes must resolve the exact target from current state; do not mutate the first visually similar record.
3. Seeds/imports are small, idempotent and duplicate-safe. Migrations preserve user edits through preconditions/compare-and-set behavior where relevant.
4. Material/destructive changes need current-state proof, bounded affected set, recovery and a clear changed/no-op/conflict result.
5. One-time work must terminate: explicit setup/database action or guarded one-shot path, then no-op. Never leave migration/seed logic on normal frontend `init`/`wp` requests.
6. For FTP mirrors, classify topology before choosing a DB path. Local WP-CLI is only reliable for a complete runnable WordPress tree; local MySQL is not the normal path when `DB_HOST` is server-local (`localhost`/loopback).
7. Prefer the authenticated server-side WordPress database capability (`$wpdb`/WP APIs). Remote WP-CLI/SSH or reachable remote MySQL are optional capabilities, not assumptions. WordPress REST is suitable for simple object operations.
8. If the ideal server path is unavailable, a temporary helper is a last fallback only when authenticated, random-token/expiry guarded, bounded, one-shot, verified and removed locally + remotely in the same task.
9. Read SQL stays read-only. Structured mutation must snapshot/prove the affected set before change and read back after change; broad destructive mutation needs explicit confirmation.
10. For Bricks persisted trees, resolve the exact post/template, read current value, preserve unrelated nodes, use compare-and-set/current-state proof, validate canonical structure, write minimally, then read back.

## Verification

- Second seed run is no-op or intentionally incremental; duplicate posts/media/templates are not created.
- Unexpected user-edited state produces conflict instead of overwrite.
- Mutation has a recovery point/rollback path when material.
- No credential is returned in tool output.
- No completed one-time setup/helper remains on frontend runtime or hosting.
- Same failed execution path is not retried indefinitely; keep the same `task_id` and switch to another bounded path after one corrective failure.
