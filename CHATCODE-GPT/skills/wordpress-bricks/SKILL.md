# WordPress + Bricks Native Delivery

## Activation

Mandatory for projects that inspection identifies as WordPress + Bricks. Activate from project evidence, not prompt wording. Keep conventions isolated per project and preserve confirmed project decisions.

## Delivery order

Use the first level that fully satisfies the request:

1. Bricks native element/control/template.
2. Bricks dynamic data / Query Loop / conditions.
3. WordPress or WooCommerce public API/hook.
4. Custom Bricks Element only for a proven native gap.
5. Shortcode wrapper only for legacy compatibility or an explicit request.

A section made from normal container/grid/image/icon/text/button/slider/query-loop building blocks is not a custom-element candidate by default. Do not create a custom element merely to avoid building native Bricks structure.

## Fast task policy

- Start from `prepare_task` ranked owners and read more only when a missing dependency blocks a safe edit.
- Preserve user scope: one section stays one section; a CSS fix does not authorize a theme refactor.
- Existing owner first. A normal edit defaults to zero new source files.
- Reuse current renderer, CSS owner, data source and Builder structure instead of creating parallel implementations.
- Prefer one small patch and task-specific verification; stop when the request is satisfied.
- Never guess Bricks APIs, IDs, data rows, live URLs, media assignments or asset paths.

## Prefix policy

Discover the project's prefix, but apply it only at collision/security/storage boundaries:

- PHP functions/classes/constants in the global namespace;
- hooks/actions, AJAX actions, nonces and asset handles;
- option/meta keys and custom Bricks element names;
- one component root CSS class when useful for isolation.

Do **not** prefix private methods, local variables, Builder labels, repeater field keys, file names, or every descendant CSS class. Prefer namespaces/classes for internal PHP where the existing project supports them. Example: `.bci-product-card .media .title`, not `.bci-product-card .bci-product-card__media .bci-product-card__title` unless the project already uses that convention for a real reason.

## Project scope and ownership

`LOCK TARGET -> INSPECT -> resolve owner -> smallest native patch -> verify -> STOP`

When one project is named, stay on it. Cross-project reads require an explicitly named reference/copy/migration source and remain read-only.

Brain may index broadly, but content reads start with the active child theme and directly related project-owned plugins. Widen to Bricks parent, Woo core or WordPress core only on concrete dependency/API evidence.

Builder/user-edited data is source of truth after initial seed. WordPress owns posts/taxonomies/media/menus/routing. WooCommerce owns cart/session/checkout/order behavior only when Woo is actually detected or explicitly requested. Reuse shared product/post renderers and global design tokens.

## Media and icons

Reference images require slot-level identity, not whole-page keyword guessing. Map `slot -> reference component/selector -> source URL -> attachment ID -> allow_reuse`; default `allow_reuse=false`. Unresolved slots stay unresolved rather than silently reusing another image. Verify duplicate attachment IDs across repeated items.

Functional icons should use Bricks Icon elements or installed Bricks icon controls/classes. Custom-element repeaters should expose an icon control. Brand marks/certifications/Zalo/logos use real media/SVG assets. Do not embed icon markup inside ordinary text strings or keep large SVG data URIs in PHP.

## Data and migration lifecycle

Normal layout/template/setup work is not a migration. Use migration machinery only for already-persisted Builder/DB/content state that must be safely upgraded while preserving edits.

Real seeds/migrations must be targeted, idempotent, concurrency-safe and recoverable when material. Preserve Bricks IDs, reciprocal parent/children, sibling order and unrelated settings.

**One-time setup must have an end state.** Run it through an explicit setup/admin/WP-CLI action or a guarded versioned migration path. After success it must become a no-op and must not keep performing one-time work on normal frontend `init`/`wp` requests. Do not leave page/template/media seed logic permanently attached to frontend runtime.

## Progressive resource loading

Runtime attaches `core-checklist.md` plus at most one task-domain resource for ordinary work:

- retrieval/source scope -> `retrieval-scope.md`
- files/prefix/architecture -> `code-organization.md`
- UI/CSS -> `design-system.md`
- Builder controls/custom elements -> `builder-editability.md`
- reference media/icons -> `media-icons.md`
- seed/data creation -> `data-seeding.md`
- templates -> `templates.md`
- Woo behavior -> `woocommerce.md`
- persisted transformations -> `migrations.md`
- broad audit -> `validation.md`

`snippets.md` and `patterns.md` are examples only and are not auto-loaded. Do not load resources just because a generic word such as `product` appears.

## Completion

Verify only touched scope: syntax when available, relevant Bricks structure/conditions, Builder editability, responsive states, duplicate media/data, generated CSS/cache when required, no unnecessary new owner/custom element/migration, and no one-time setup still doing work on frontend requests.

Only save durable project decisions that the user explicitly confirmed. Never store guesses, credentials, secrets, URLs or transient record IDs. If a required check cannot run, report that limitation exactly.
