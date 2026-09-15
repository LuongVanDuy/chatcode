# WordPress + Bricks Native Delivery v6 contract

Mandatory umbrella contract for WordPress + Bricks. Runtime adds task-specific domain packs. Every Bricks coding task must `prepare_task` before mutation.

## Workflow

`LOCK TARGET -> prepare_task -> skill receipt -> evidence -> owner-scoped change -> complete_task -> PASS -> STOP`

- When Bricks is detected, tell the user exactly: **“Tôi sẽ sử dụng Bricks skill.”**
- Reads/inspect are discovery only. Prepare the real project/root for each coding task; changed execution paths stay in the same `task_id`.
- Best practice is not a permission boundary. HARD blocks cover destructive, cross-project, corrupt or irreversible risk; otherwise take one targeted proof and use a bounded reversible fallback.
- Preserve unrelated Builder edits and do not broaden task scope without need.

## Evidence hard gate

- Existing **Bricks element IDs** referenced by selectors/query targets/migrations require current-task persisted-tree evidence. Chat history, clone, DOM/export or another project do not count.
- Numeric **WordPress media IDs** introduced by a patch require live attachment evidence from the current project.
- Prefer semantic/global classes. `#brxe-*` is evidence checked; `[data-field-id]` requires explicit user scope.
- New top-level PHP symbols receive duplicate-owner preflight; duplicate hooks are checked separately.

## Native order

1. Bricks native element/control/template.
2. Dynamic data / Query Loop / conditions / Global Queries.
3. WordPress/Woo public API or hook.
4. Custom Bricks Element for a proven native gap.
5. Shortcode only for compatibility or explicit request.

Normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap. Builder-editable content stays in Bricks tree/controls.

## Ownership

- Reuse the correct functional owner, not merely the first existing file.
- Keep child-theme `functions.php` for **bootstrap/require/enqueue** by default. **Small fixes** to existing code may stay in place; new features/migrations do not.
- Global tokens stay global; page/component CSS stays local.
- **Zero new** source files is a preference, not a blocker; one bounded correct owner is allowed when needed.

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

UI tasks receive bounded deterministic matches; project tokens/components remain source of truth.

## Cross-cutting invariants

- One-time setup/seed reaches terminal no-op; seed/diagnostic/repair/cleanup normally stay in one task.
- FTP mirrors must classify DB topology. Prefer the server-side database capability; a temporary helper is only an authenticated, bounded one-shot fallback cleaned in the same task.
- Bricks 2.3.13 exact shapes require exact version evidence; otherwise use invariants/local persisted evidence. Read tolerantly; write canonical data.
- `complete_task` owns scoped verification and configured changed-file deploy; do not duplicate successful sync.
- Completion separates code, deploy, responsive and live verification. UI PASS needs desktop/tablet/mobile evidence; write/upload is not live visual proof.
- Same root cause gets one corrective pass. If it repeats unchanged, stop that path and choose another bounded fallback; do not loop or open a new task.

Persist only durable user-confirmed decisions. Never store guesses or credentials. Report unavailable checks exactly.
