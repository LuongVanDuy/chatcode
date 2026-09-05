# WordPress + Bricks Native Delivery v5

## Role

This is the mandatory umbrella contract for projects identified as WordPress + Bricks. Task-specific knowledge is attached as **domain packs**.

## Core workflow

`LOCK TARGET -> prepare_task -> use ranked owner/context -> apply smallest valid change -> verify touched scope -> STOP`

- Use project evidence, Project Profile and Owner Resolver before guessing.
- Existing owner/component/data source first; normal edits default to zero new source files.
- Read more only for a concrete dependency.
- Preserve Builder/user-edited state and confirmed project decisions.
- Do not broaden into Git, research, migration, refactor or unrelated deployment; configured post-edit sync is allowed.
- Keep a named reference site/domain as the scoped source unless unavailable or wider research is requested.

## Native delivery order

Use the first level that fully satisfies the request:

1. Bricks native element/control/template.
2. Bricks dynamic data / Query Loop / conditions.
3. WordPress or WooCommerce public API/hook.
4. Custom Bricks Element only for a proven native gap.
5. Shortcode wrapper only for legacy compatibility or explicit request.

Normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap.

## Domain routing

Runtime attaches `core-checklist.md` plus at most **two** domain packs only when genuinely cross-cutting:

- `wordpress` — PHP/theme/plugin/hooks/security/ownership.
- `bricks` — Builder controls/templates/dynamic data/custom elements.
- `woocommerce` — cart/checkout/order/Woo behavior.
- `media` — reference images, attachments, SVG/logo/icons.
- `data` — seed/import/persisted migrations/cleanup lifecycle.
- `ui` — hierarchy, responsive, typography, components/interaction.

A simple task normally gets zero or one domain. Generic words such as `product` do not automatically activate WooCommerce. UI tasks do not activate Builder rules unless Builder structure/controls/templates are actually touched.

## Searchable UI knowledge

For `ui` tasks, runtime performs deterministic local search and attaches at most three matching guidelines. Treat them as recommendations, not project overrides:

- project tokens/components remain source of truth;
- apply only matches relevant to the touched target;
- no web search or terminal process is needed;
- no useful match means no invented database match.

## Cross-cutting invariants

- Prefix collision/storage/security/public identity boundaries only, not every local/descendant identifier.
- Reference media is slot-specific; accidental attachment reuse is not acceptable by default.
- Functional icons use verified Bricks/native infrastructure; brand marks use real assets.
- One-time setup/migration must terminate and become a frontend no-op.
- Global tokens stay with the established global owner; component styling stays scoped unless evidence proves a global issue.

## Project FTP completion

If `.vscode/sftp.json` has `uploadOnSave:true`, sync only current-task changed files after verification. `ftp_deploy` is authoritative; never upload twice. Legacy/direct writes without it use one Trusted Terminal `exec`, never VS Code/Ctrl+S. Credentials stay local to the terminal; remote target is `remotePath + project-relative path`. Delete remote only when the task deleted that file and `watcher.autoDelete:true`. Report skip/failure exactly.

## Completion

Verify only what changed: relevant syntax, Builder structure/editability, Woo semantics, responsive/interaction UI, media uniqueness, and migration idempotency/lifecycle.

Persist only durable user-confirmed project decisions. Never store guesses, credentials, secrets, live URLs or transient IDs. If required verification cannot run, state that exactly.
