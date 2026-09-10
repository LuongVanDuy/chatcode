# Compact core checklist

Loaded for every WordPress + Bricks task. Keep only cross-task rules here; domain packs own details.

## Before editing

- Lock to the user-named target/project.
- Use current project evidence; do not guess owner, template ID, Builder tree, media ID or path.
- Search/Brain first, then read project-owned code. Open Bricks/Woo/WP core only for a concrete missing dependency.
- Keep external references scoped: use the named source first and do not broad-search unrelated websites.
- Reuse the correct functional owner, not merely the first existing file or candidate. Existing small fixes normally create zero new source files.
- Keep child-theme `functions.php` for bootstrap/require/enqueue by default. New custom features belong in a suitable functional module when the task allows; zero-file defaults never justify the wrong owner, and explicit user/task scope still wins.
- Prefer native Bricks structure/dynamic data before custom source.
- Preserve unrelated Builder/user edits and shared renderers.

## Naming

Keep local names short. The theme/project folder already supplies project identity.

- Files/classes: `home.css`, `home.php`, `.home-hero`, not brand-prefixed local names.
- Prefix only real collision/storage boundaries: public PHP symbols, hooks/handles, option/meta keys, custom element names.
- Do not create per-section/helper/fix/v2 owner files.

## During editing

- Make the smallest owner-scoped patch.
- A normal code/layout/template change is not a migration.
- One-time setup must terminate and become a no-op after success.
- Before creating a Bricks template, resolve/adopt the existing intended template by stable ID/marker, type and conditions.
- Global tokens stay in the global CSS owner; page/component rules stay local.

## Completion

- `complete_task` owns scoped syntax/structural verification and configured changed-files FTP deploy.
- Do not duplicate successful FTP, Git, browser, DB or snapshot work manually.
- Verify only touched scope and direct dependencies.
- If verification passes, stop.
- If verification fails, correct the identified cause in the same task. A repeated unchanged failure is a reason to stop and report the blocker, not prepare again or invent another workflow.

If a required check cannot run, report that limitation rather than implying PASS.
