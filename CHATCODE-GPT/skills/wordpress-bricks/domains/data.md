# Data and migration domain

Use for seed/import, persisted Builder/content upgrades, database transformations and cleanup that changes stored state.

## Procedure

1. Distinguish initial setup from migration. New layout/template code is not a migration merely because it creates content once.
2. Persisted changes must resolve the exact target from current state; do not mutate the first visually similar record.
3. Seeds/imports are idempotent and duplicate-safe. Migrations preserve user edits through preconditions/compare-and-set behavior where relevant.
4. Material/destructive changes need recovery and a clear changed/no-op/conflict result.
5. One-time work must have an end state: explicit setup/admin/WP-CLI action or guarded versioned path, then no-op.
6. Do not leave page/template/media/data seed logic doing work on ordinary frontend `init`/`wp` requests after success.
7. For Bricks persisted trees, preserve unique IDs, reciprocal parent/children and sibling order.

## Verification

- Second run is no-op or intentionally incremental.
- Duplicate posts/media/templates are not created.
- Conflict preserves unexpected user-edited state rather than overwriting it.
- No completed one-time setup remains active on frontend requests.
