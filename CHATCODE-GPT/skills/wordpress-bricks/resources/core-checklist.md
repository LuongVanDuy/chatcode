# Compact core checklist

Loaded for every WordPress + Bricks task. Keep only cross-task rules here; domain packs own details.

## Before editing

- Lock to the user-named target/project. Every new Bricks coding task must go through `prepare_task`; `inspect_project`/read calls never authorize mutation for a later task.
- When Bricks is detected, tell the user exactly: **“Tôi sẽ sử dụng Bricks skill.”**
- Confirm the prepared project identity/root from current workspace evidence. Do not trust only chat history or a prior project's context.
- Use current project evidence; do not guess owner, template ID, Builder tree, media ID or path.
- **Bricks element IDs are task-local evidence.** Before using an existing ID in CSS/selectors/query targets/migrations, read the current persisted Bricks tree in the same task. The evidence ledger blocks unverified IDs before mutation.
- Never reuse an element ID from chat history, a cloned element, frontend export/DOM or another project. New IDs defined by the same canonical patch are separate from references to existing IDs.
- **Attachment/media IDs are live site-local evidence.** Numeric media IDs introduced by the patch must be verified as current WordPress `attachment` posts in this task/project; URL/file name or old code does not prove existence.
- Search/Brain first, then read project-owned code. Open Bricks/Woo/WP core only for a concrete missing dependency.
- Keep external references scoped: use the named source first and do not broad-search unrelated websites.
- Reuse the correct functional owner, not merely the first existing file or candidate. Low owner confidence means one targeted proof/read, not task abandonment.
- Keep child-theme `functions.php` for bootstrap/require/enqueue by default. New custom features belong in a suitable functional module when practical; zero-new-file/native-first are preferences, not permission gates.
- Prefer native Bricks structure/dynamic data before custom source. Preserve unrelated Builder/user edits and shared renderers.

## Guard severity

- **HARD** — destructive/cross-project/wrong-root/corrupt/irreversible risk, unsafe path, malformed Bricks tree, or duplicate fatal PHP symbol: block before mutation.
- **SOFT** — owner uncertainty, unavailable ideal DB/API path, one-time seed/helper, repair, or need for one bounded new owner: gather one targeted proof then use the smallest reversible fallback.
- **ADVISORY** — native-first, avoid `functions.php`/shortcode/temp helper/direct DB, zero-new-files, semantic/current-owner preference: follow when possible, but do not abandon a clear safe task solely for these preferences.
- Seed, diagnostic, repair, fallback and cleanup normally stay in the **same `task_id`**.

## Naming & selectors

Keep local names short. The theme/project folder already supplies project identity.

- Files/classes: `home.css`, `home.php`, `.home-hero`, not brand-prefixed local names.
- Prefix only real collision/storage boundaries: public PHP symbols, hooks/handles, option/meta keys, custom element names.
- Do not create per-section/helper/fix/v2 owner files as a habit; one correct bounded owner is allowed when the responsibility truly has no owner.
- Prefer semantic classes/global classes controlled by the project. New `#brxe-*` references must be evidenced; `[data-field-id]` coupling is rejected unless the current user task explicitly requires it.

## During editing

- Make the smallest owner-scoped patch.
- A normal code/layout/template change is not a migration.
- One-time setup must terminate and become a no-op after success.
- For FTP mirrors, do not assume local WP-CLI or local MySQL. Use the server-side database capability/fallback hierarchy when data work is required.
- Temporary one-shot helper is allowed only when authenticated, bounded, expiring, verified and cleaned in the same task.
- Before creating a Bricks template, resolve/adopt the existing intended template by stable ID/marker, type and conditions.
- Global tokens stay in the global CSS owner; page/component rules stay local. Do not append unrelated overrides to `style.css`.
- Builder-editable UI must remain editable through the Bricks tree/controls.
- New top-level PHP function/class/interface/trait/enum declarations are checked against current Project Brain symbols before patching. New hook registrations receive duplicate-owner/callback search.

## Completion

- `complete_task` owns scoped syntax/structural verification and configured changed-files FTP deploy.
- Bricks evidence lint runs before mutation; missing element/media evidence or unstable unrequested selectors must fail before files change.
- For touched PHP, syntax checks and duplicate public symbol/hook ownership checks are separate requirements.
- UI/layout work requires desktop, tablet and mobile verification.
- Do not duplicate successful FTP, Git, browser, DB or snapshot work manually.
- Definition of Done is split into **code verification**, **deployment**, **responsive verification** and **live frontend verification**. A successful write/upload is not proof the frontend is correct.
- If live/browser proof is unavailable, completion must remain `code_verified_not_live_verified`; do not claim live/visual PASS.
- Verify only touched scope and direct dependencies. If verification passes, stop.
- Same root cause gets **one corrective pass**. If the unchanged failure repeats, mark that path exhausted; do not repeat the same patch/owner/command/error. Keep the task and choose another bounded fallback or report the exact blocker.

If a required check cannot run and no safe fallback exists, report that limitation rather than implying PASS.
