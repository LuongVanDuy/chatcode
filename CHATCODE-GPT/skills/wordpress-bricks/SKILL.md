# WordPress + Bricks Native Delivery v6 contract

Mandatory umbrella contract for WordPress + Bricks. Runtime adds task-specific domain packs. **Every Bricks coding task must be prepared with this skill before mutation.**

## Mandatory workflow

`LOCK TARGET -> prepare_task -> wordpress-bricks receipt -> prove current-task evidence -> smallest owner-scoped change -> complete_task -> verify -> PASS -> STOP`

- When Bricks is detected, tell the user exactly: **“Tôi sẽ sử dụng Bricks skill.”**
- `inspect_project`, search and reads are discovery only. They never authorize a write. Every new coding task must `prepare_task` again for the real project/root and receive a task receipt.
- Use project evidence/Owner Resolver; do not guess. Re-plan with the same `task_id` when evidence changes scope.
- Read only for concrete missing dependencies; preserve unrelated Builder/user edits.
- Do not broaden into Git, external research, migration, refactor or deployment unless the actual task requires it.
- When a reference site/domain is named, keep it scoped unless unavailable or wider research is requested.

## Evidence that must never be guessed

- **Bricks element ID:** read the current persisted tree in this task before using an existing generated ID in CSS/selectors/query targets/migrations. Old chat, clones, frontend DOM/export and other projects are not authoritative.
- Existing element IDs used by the patch are checked against the task evidence ledger. Unverified IDs block `complete_task` before any mutation.
- **WordPress media ID:** IDs are site-local. Numeric attachment IDs introduced by a patch must be verified as live attachment posts on the current WordPress project. URL/file name, old task output or another site never proves an attachment ID.
- Prefer semantic project-controlled classes/global classes. `#brxe-*` selectors are linted and must reference evidenced/current IDs; new `[data-field-id]` coupling is blocked unless the user's task explicitly requires that selector.
- Task-bound reads can add persisted-tree evidence. For live WordPress state, use the current task/work-session and a real source such as WP-CLI; do not self-report evidence.

## Native order

1. Bricks native element/control/template.
2. Dynamic data / Query Loop / conditions / Global Queries.
3. WordPress/Woo public API or hook.
4. Custom Bricks Element only for a proven native gap.
5. Shortcode only for legacy compatibility or explicit request.

Normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap. Editable content must remain editable in Bricks tree/controls.

## Ownership

- Reuse the correct functional owner, not merely the first existing file.
- Keep child-theme `functions.php` for bootstrap/require/enqueue by default. Small fixes to existing code may stay in place; **new features, migrations and large inline JS do not belong there**.
- Global tokens stay in the global owner. Page/component CSS stays in its established page/component owner. Do not accumulate unrelated `style.css` overrides.
- New top-level PHP functions/classes/interfaces/traits receive a duplicate-symbol preflight against Project Brain before patch application. New hook registrations are searched for existing callback/hook ownership and duplicate candidates are reported.
- Zero new source files is an ordinary-edit default, not a reason to choose the wrong owner; explicit user scope still applies.

## Domain routing

Runtime attaches the compact core plus at most **two** domain packs:

- `wordpress` — PHP/theme/hooks/ownership
- `bricks` — Builder/templates/dynamic data/components
- `woocommerce` — cart/checkout/order/account
- `media` — reference media/icons
- `data` — seed/import/migration lifecycle
- `ui` — responsive/design/interaction

Generic words such as `product` do not automatically activate WooCommerce.

## Searchable UI knowledge

UI tasks receive at most a few deterministic local matches. Project tokens/components remain source of truth.

## Cross-cutting invariants

- Prefix only collision/storage/public boundaries, not local filenames or descendant classes.
- One-time setup/migration must reach a terminal no-op state.
- Bricks 2.3.13 exact shapes are used only when version evidence is exact; otherwise use invariant rules and inspect local evidence instead of guessing.
- Read existing Bricks data tolerantly; generate canonical nodes.
- `complete_task` owns scoped verification and configured changed-file FTP deployment; never duplicate a successful sync manually.
- Completion state is explicit: `code_verified`, deployment state, responsive requirement and live verification are separate. A successful write/upload is never promoted to visual/live PASS.
- UI work requires desktop/tablet/mobile verification. If ChatCode has no live/browser evidence, the result remains `code_verified_not_live_verified` and the user must be told that limitation.
- Verify touched scope only. PASS means STOP. Retry only after correcting a known cause.

Persist only durable user-confirmed decisions. Never store guesses/credentials. Report unavailable checks exactly.
