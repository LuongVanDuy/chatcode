# WordPress domain

Use for PHP/theme/plugin structure, hooks, admin/settings behavior, routing and WordPress-owned content that is not primarily a Bricks Builder or WooCommerce behavior task.

## Procedure

1. Reuse the current project owner, bootstrap pattern and naming convention.
2. Prefer WordPress public APIs/hooks over load-time side effects or direct core edits.
3. Keep child-theme `functions.php` thin: bootstrap/require/enqueue. Small fixes to existing owned code may stay, but new features, migrations, large inline JS and unrelated renderers go to the correct functional module.
4. Before adding a public function/class/hook, inspect existing project symbols/hooks so the task does not create a duplicate owner or fatal redeclaration.
5. Prefix only public/global collision, storage or security boundaries. Internal/local identifiers stay concise.
6. Sanitize input, enforce capability/nonce where authorization matters, and escape output at render boundaries.
7. Keep admin-only/setup-only work off ordinary frontend requests.

## Verification

- `php -l` for touched PHP files.
- New public function/class/hook does not duplicate an existing project symbol/owner.
- Hook executes in the intended context only.
- No duplicate owner/bootstrap or unnecessary new file.
- No frontend request receives one-time/admin-only work.
