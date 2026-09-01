# WordPress + Bricks Native Delivery v5

## Role

This is the mandatory umbrella contract for projects that inspection identifies as WordPress + Bricks. It is intentionally small. Task-specific knowledge is attached by the runtime as **domain packs**, not embedded here.

## Core workflow

`LOCK TARGET -> prepare_task -> use ranked owner/context -> apply smallest valid change -> verify touched scope -> STOP`

- Use project evidence, Project Profile and Owner Resolver before guessing conventions.
- Existing owner/component/data source first. A normal edit defaults to zero new source files.
- Read more only when a concrete dependency blocks a safe change.
- Preserve Builder/user-edited state and confirmed project decisions.
- Do not broaden into Git, external research, migration, refactor or deployment unless the user/task actually requires it.
- When a reference site/domain is named, keep reference research scoped to that source unless it is unavailable/insufficient or wider research is explicitly requested.

## Native delivery order

Use the first level that fully satisfies the request:

1. Bricks native element/control/template.
2. Bricks dynamic data / Query Loop / conditions.
3. WordPress or WooCommerce public API/hook.
4. Custom Bricks Element only for a proven native gap.
5. Shortcode wrapper only for legacy compatibility or an explicit request.

Normal container/grid/image/icon/text/button/slider/query composition is not a custom-element gap.

## Domain routing

Runtime attaches `core-checklist.md` plus at most **two** domain packs only when the request is genuinely cross-cutting:

- `wordpress` — PHP/theme/plugin/hooks/security/WordPress ownership.
- `bricks` — Builder controls/templates/dynamic data/custom elements.
- `woocommerce` — cart/checkout/order/Woo-specific behavior.
- `media` — reference images, attachments, SVG/logo and functional icons.
- `data` — seed/import/persisted migrations/cleanup lifecycle.
- `ui` — visual hierarchy, responsive behavior, typography, components and interaction.

A simple task should normally receive zero or one domain. Generic words such as `product` do not automatically activate WooCommerce. UI tasks do not automatically activate Builder implementation rules unless the request actually touches Builder structure/controls/templates.

## Searchable UI knowledge

For `ui` tasks, runtime performs a deterministic local search and attaches at most three matching UI guidelines. Treat these as verified recommendations, not project overrides:

- current project tokens/components remain source of truth;
- apply only matches relevant to the touched target;
- no web search or terminal process is needed for this knowledge lookup;
- if no useful match exists, do not invent a database match.

## Cross-cutting invariants

- Prefix only collision/storage/security/public identity boundaries; do not prefix every local identifier or descendant CSS class.
- Reference media is slot-specific; accidental attachment reuse is not acceptable by default.
- Functional icons use Bricks/native verified icon infrastructure; brand marks use real assets.
- One-time setup/migration must reach a terminal no-op state and must not keep doing setup work on normal frontend requests.
- Global design tokens belong to the established global owner; page/component styling stays with its scoped owner unless evidence proves the problem is global.

## Completion

Verify only what changed: syntax when relevant, Builder structure/editability when touched, Woo semantics when touched, responsive/interaction behavior for UI, media uniqueness when importing, and migration idempotency/lifecycle for stored-state changes.

Only persist durable project decisions explicitly confirmed by the user. Never store guesses, credentials, secrets, live URLs or transient record IDs. If a required verification cannot run, state that limitation exactly.
