# Compact core checklist

Loaded for every WordPress + Bricks task. Domain packs own detailed rules.

## Before editing

- Lock the user-named project/root. Every new Bricks coding task goes through `prepare_task`; inspect/read never authorizes a later mutation.
- When Bricks is detected, tell the user exactly: **“Tôi sẽ sử dụng Bricks skill.”**
- Keep external references scoped; do not broad-search unrelated websites.
- Use current project evidence; never guess owner, template ID, Builder tree, media ID or path.
- **Bricks element ID is task-local evidence.** Existing IDs used by CSS/selectors/query targets/migrations must come from the current persisted Bricks tree. Do not reuse IDs from chat history, clones, frontend DOM/export or another project.
- **Attachment/media IDs are site-local evidence.** Numeric IDs introduced by a patch must be verified as current WordPress attachments in this task/project; URL, filename or old code is not proof.
- Search/Brain first, then read project-owned code. Open WP/Bricks/Woo core only for a concrete missing dependency.
- Reuse the correct functional owner, not the first candidate. Low confidence means one targeted proof/read, then a bounded fallback. Zero-file defaults never justify the wrong owner.
- Keep child-theme `functions.php` for **bootstrap/require/enqueue** by default. **Small fixes** to existing owner code may stay there; new features/migrations/large inline JS should use the correct module. **Zero new** files is a preference, not a permission gate.
- Prefer native Bricks structure/dynamic data and preserve unrelated Builder/user edits.

## Guard severity

- **HARD** — cross-project/wrong-root, unsafe/destructive/corrupt/irreversible mutation, malformed persisted Bricks tree, or duplicate fatal PHP symbol. Block before mutation.
- **SOFT** — owner uncertainty, unavailable ideal DB/API path, one-shot helper/seed, repair, or one bounded new owner. Take one targeted proof, then use the smallest reversible fallback.
- **ADVISORY** — native-first, semantic/current-owner preference, avoid `functions.php`/shortcode/temp helper/direct DB, zero-new-files. Follow when possible; do not abandon a safe clear task solely for these preferences.
- Diagnostic, seed, repair, fallback and cleanup stay in the same `task_id` unless a HARD boundary requires stopping.

## Naming & selectors

- Keep local names short: `home.css`, `home.php`, `.home-hero`.
- Prefix only collision/storage/public boundaries: public PHP symbols, hooks/handles, option/meta keys, custom element names.
- Prefer semantic/global classes. New `#brxe-*` references require current task evidence; `[data-field-id]` coupling requires explicit user scope.
- Do not create helper/fix/v2 files by habit; one bounded correct owner is allowed when responsibility truly has no owner.

## During editing

- Make the smallest owner-scoped patch. A normal code/layout/template change is not a migration.
- One-time setup must terminate and become a no-op after success.
- For FTP mirrors, do not assume local WP-CLI/MySQL. Prefer the server-side database capability. A temporary helper is allowed only as authenticated, bounded, expiring one-shot fallback and must be cleaned in the same task.
- Resolve/adopt an existing intended Bricks template by stable ID/marker, type and conditions before creating another.
- Global tokens stay in the global CSS owner; page/component rules stay local. Do not append unrelated overrides to `style.css`.
- Builder-editable UI must remain editable through the Bricks tree/controls.
- New top-level PHP function/class/interface/trait/enum declarations require current symbol preflight; new hooks require duplicate-owner/callback search.

## Completion

- `complete_task` owns scoped syntax/structural verification and configured changed-files FTP deploy.
- Bricks evidence lint runs before mutation; missing element/media evidence or unstable unrequested selectors fail before files change.
- Touched PHP needs syntax plus duplicate public symbol/hook ownership checks.
- UI/layout work requires desktop, tablet and mobile verification.
- Do not duplicate successful FTP, Git, browser, DB or snapshot work manually.
- Definition of Done separates **code verification**, **deployment**, **responsive verification** and **live frontend verification**. Write/upload success is not frontend proof.
- If live/browser proof is unavailable, keep `code_verified_not_live_verified`; never claim live/visual PASS.
- Verify touched scope and direct dependencies only. If PASS, stop.
- Same root cause gets **one corrective pass**. If unchanged failure repeats, mark the path exhausted; do not repeat the same patch/owner/command/error. Keep the task and choose another bounded fallback or report the blocker.

If a required check cannot run and no safe fallback exists, report the limitation instead of implying PASS.
