# WordPress domain

Use for PHP/theme/plugin structure, hooks, admin/settings behavior, routing and WordPress-owned content that is not primarily a Bricks Builder or WooCommerce behavior task.

## Procedure

1. Reuse the current project owner, bootstrap pattern and naming convention.
2. Prefer WordPress public APIs/hooks over load-time side effects or direct core edits.
3. Keep `functions.php`/plugin bootstrap thin when the project already has clear owners; do not refactor structure merely because a different architecture is possible.
4. Prefix only public/global collision, storage or security boundaries. Internal/local identifiers stay concise.
5. Sanitize input, enforce capability/nonce where authorization matters, and escape output at render boundaries.
6. Keep admin-only/setup-only work off ordinary frontend requests.

## Verification

- PHP syntax for touched PHP files.
- Hook executes in the intended context only.
- No duplicate owner/bootstrap or unnecessary new file.
- No frontend request receives one-time/admin-only work.
