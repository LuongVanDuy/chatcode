# WordPress + Bricks Native Delivery v6 contract

Mandatory umbrella contract for WordPress + Bricks. Runtime adds task-specific domain packs. Every Bricks coding task must be prepared with this skill before mutation.

## Mandatory workflow

`LOCK TARGET -> prepare_task -> wordpress-bricks receipt -> prove current-task evidence -> smallest owner-scoped change -> complete_task -> PASS -> STOP`

- When Bricks is detected, tell the user exactly: **“Tôi sẽ sử dụng Bricks skill.”**
- `inspect_project`/reads are discovery only; every new coding task must `prepare_task` again for the real project/root. Re-plan changed scope with the same `task_id`.
- Use project evidence/Owner Resolver; preserve unrelated Builder/user edits. Do not broaden into Git, external research, migration, refactor or deployment unless the task requires it.
- When a reference site/domain is named, keep it scoped unless unavailable or wider research is requested.

## Evidence hard gate

- Existing **Bricks element IDs** used by selectors/query targets/migrations must come from the current task persisted tree. Chat history, clones, frontend DOM/export and other projects do not count. Unverified IDs block mutation.
- Numeric **WordPress media IDs** introduced by a patch must be verified as live attachments on the current WordPress project. URL/file name or old task output is not evidence.
- Prefer semantic/global classes. `#brxe-*` is linted against task evidence; new `[data-field-id]` coupling is rejected unless explicit user scope requires it.
- New top-level PHP symbols receive duplicate-owner preflight; duplicate hook candidates are reported before patching.

## Native order

1. Bricks native element/control/template.
2. Dynamic data / Query Loop / conditions / Global Queries.
3. WordPress/Woo public API or hook.
4. Custom Bricks Element only for a proven native gap.
5. Shortcode only for legacy compatibility or explicit request.

Normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap. Editable content must remain editable in Bricks tree/controls.

## Ownership

- Reuse the correct functional owner, not merely the first existing file.
- Keep child-theme `functions.php` for **bootstrap/require/enqueue** by default. Small fixes to existing code may stay in place; new features, migrations and large inline JS do not belong there.
- Global tokens stay in the global owner; page/component CSS stays in its established owner. Do not accumulate unrelated `style.css` overrides.
- Zero new source files is an ordinary-edit default, not a reason to choose the wrong owner; explicit user scope still applies.

## Domain routing

Runtime attaches the compact core plus at most **two** domain packs:

- `wordpress` — PHP/theme/hooks/ownership
- `bricks` — Builder/templates/dynamic data/components
- `woocommerce` — cart/checkout/order/account
- `media` — media/icons
- `data` — seed/import/migration lifecycle
- `ui` — responsive/design/interaction

Generic words such as `product` do not automatically activate WooCommerce.

## Searchable UI knowledge

UI tasks receive bounded deterministic local matches. Project tokens/components remain source of truth.

## Cross-cutting invariants

- Prefix only collision/storage/public boundaries, not local filenames or descendant classes.
- One-time setup/migration must reach a terminal no-op state.
- Bricks 2.3.13 exact shapes apply only to exact version evidence; otherwise use invariant rules and local evidence instead of guessing. Read existing Bricks data tolerantly; generate canonical nodes.
- `complete_task` owns scoped verification and configured changed-file FTP deployment; never duplicate successful sync manually.
- Completion separates **code verification**, deployment, responsive verification and live frontend verification. UI work requires desktop/tablet/mobile; write/upload success is not live visual PASS. Without live/browser proof, report the limitation.
- Verify touched scope only. PASS means STOP. Retry only after correcting a known cause.

Persist only durable user-confirmed decisions. Never store guesses/credentials. Report unavailable checks exactly.
