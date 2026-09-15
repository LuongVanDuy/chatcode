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
- Reuse the correct functional owner, not merely the first existing file or candidate. Existing small fixes normally create zero new source files.
- Keep child-theme `functions.php` for bootstrap/require/enqueue by default. New custom features belong in a suitable functional module when the task allows; zero-file defaults never justify the wrong owner, and explicit user/task scope still wins.
- Prefer native Bricks structure/dynamic data before custom source. Preserve unrelated Builder/user edits and shared renderers.

## Naming & selectors

Keep local names short. The theme/project folder already supplies project identity.

- Files/classes: `home.css`, `home.php`, `.home-hero`, not brand-prefixed local names.
- Prefix only real collision/storage boundaries: public PHP symbols, hooks/handles, option/meta keys, custom element names.
- Do not create per-section/helper/fix/v2 owner files.
- Prefer semantic classes/global classes controlled by the project. New `#brxe-*` references must be evidenced; `[data-field-id]` coupling is rejected unless the current user task explicitly requires it.

## During editing

- Make the smallest owner-scoped patch.
- A normal code/layout/template change is not a migration.
- One-time setup must terminate and become a no-op after success.
- Before creating a Bricks template, resolve/adopt the existing intended template by stable ID/marker, type and conditions.
- Global tokens stay in the global CSS owner; page/component rules stay local. Do not append unrelated overrides to `style.css`.
- Builder-editable UI must remain editable through the Bricks tree/controls.
- New top-level PHP function/class/interface/trait declarations are checked against current Project Brain symbols before patching. New hook registrations receive duplicate-owner/callback search.

## Completion

- `complete_task` owns scoped syntax/structural verification and configured changed-files FTP deploy.
- Bricks evidence lint runs before mutation; missing element/media evidence or unstable unrequested selectors must fail before files change.
- For touched PHP, syntax checks and duplicate public symbol/hook ownership checks are separate requirements.
- UI/layout work requires desktop, tablet and mobile verification.
- Do not duplicate successful FTP, Git, browser, DB or snapshot work manually.
- Definition of Done is split into **code verification**, **deployment**, **responsive verification** and **live frontend verification**. A successful write/upload is not proof the frontend is correct.
- If live/browser proof is unavailable, completion must remain `code_verified_not_live_verified`; do not claim live/visual PASS.
- Verify only touched scope and direct dependencies. If verification passes, stop.
- If verification fails, correct the identified cause in the same task. A repeated unchanged failure is a reason to stop and report the blocker, not prepare again or invent another workflow.

If a required check cannot run, report that limitation rather than implying PASS.
