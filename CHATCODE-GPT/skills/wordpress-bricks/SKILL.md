# WordPress + Bricks Native Delivery v5

This is the mandatory umbrella contract for WordPress + Bricks. Runtime adds small task-specific domain packs.

## Workflow

`LOCK TARGET -> prepare_task -> smallest owner-scoped change -> complete_task -> PASS -> STOP`

- Use project evidence/Owner Resolver; do not guess.
- Existing owner first. A normal edit defaults to zero new source files.
- Read more only for one concrete missing dependency.
- Re-plan with the existing `task_id` when new evidence changes scope. Do not restart preparation to work around an error.
- Preserve unrelated Builder/user edits.
- Do not broaden into Git, external research, migration, refactor or deployment unless the actual task requires it.
- When a reference site/domain is named, keep it as the scoped source unless unavailable or wider research is requested.

## Native order

1. Bricks native element/control/template.
2. Dynamic data / Query Loop / conditions.
3. WordPress/Woo public API or hook.
4. Custom Bricks Element only for a proven native gap.
5. Shortcode only for legacy compatibility or explicit request.

Normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap.

## Domain routing

Runtime attaches the compact core plus at most **two** domain packs:

- `wordpress` — PHP/theme/hooks/ownership
- `bricks` — Builder/templates/dynamic data
- `woocommerce` — cart/checkout/order
- `media` — reference media/icons
- `data` — seed/import/migration lifecycle
- `ui` — responsive/design/interaction

A normal task gets zero or one domain. Generic words such as `product` do not automatically activate WooCommerce.

## Searchable UI knowledge

UI tasks receive at most two deterministic local matches. Project tokens/components remain source of truth; irrelevant matches are ignored; no web/terminal search is required.

## Cross-cutting invariants

- Prefix only collision/storage/public boundaries, not local filenames or descendant classes.
- Reference media remains slot-specific; do not silently reuse unresolved assets.
- One-time setup/migration must reach a terminal no-op state.
- Global tokens stay in the global owner; page/component styles stay scoped.
- `complete_task` owns scoped verification and configured changed-file FTP deployment; never duplicate a successful sync manually.
- Verify touched scope only. PASS means STOP.
- Follow the user's current scope and explicit exceptions. Defaults such as zero new files or distinct reference media do not override a request to create a page or reuse placeholder images.
- Retry only after identifying and correcting the cause. If the same error persists, stop and report it; do not cycle through prepare, shell, FTP and live polling.
- `finish_work(cancel:true)` stops active work while preserving files. A failed FTP is retried through `finish_work` on the same session, without applying the patch again.

Persist only durable user-confirmed project decisions. Never store guesses, credentials or transient diagnostics. If a required check cannot run, report that limitation exactly.
