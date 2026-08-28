# WordPress + Bricks Native Delivery

Use this skill only when the project is WordPress + Bricks. Keep work Bricks-native, editable in Builder, project-independent, and as small as the task allows.

This entry is intentionally compact for ChatGPT. Detailed rules live in routed resources and should be read only when attached to the current task.

## Core decision order

Choose the smallest valid solution in this order:

1. **Bricks native element/control/template**.
2. **Bricks dynamic data / Query Loop / conditions**.
3. **WordPress or WooCommerce public API/hook**.
4. **Custom Bricks Element** only for a proven native gap.

Do not build parallel PHP/HTML behavior when the installed Bricks/Woo stack already owns it.

## Mandatory workflow

`INSPECT -> identify the real render/data owner -> reuse existing project system -> choose smallest patch -> backup when material -> implement -> refresh generated state when needed -> validate relevant scope`

Before editing, inspect enough current state to avoid guessing. Depending on the task this includes the active child theme/custom plugin, Bricks/Woo version, current page/template, Builder tree and conditions, menu source, assigned Woo pages, existing shared components, global design tokens, seed/migration markers, and CSS loading/cache mode.

## Non-negotiable rules

- Never edit WordPress core, Bricks parent theme, WooCommerce core, or vendor code.
- Current Builder/user-edited data is source of truth after initial seed. Never overwrite a whole Builder tree for a small update.
- Real Header/Footer/Archive/Single/Woo work uses real Bricks templates and current-version storage/conditions, not fake PHP pages.
- Bricks tree changes preserve unique IDs, reciprocal `parent`/`children`, sibling order, and unrelated settings.
- Post-seed DB changes are targeted, idempotent, Builder-preserving migrations; material changes get recovery/backup.
- Generated template/page/post/menu data must not duplicate under concurrent requests. Use stable semantic identity and concurrency-safe creation when seeding is involved.
- After Bricks DB mutation, cache/generated CSS refresh is part of the write when required by the installed setup.
- Desktop/mobile navigation consumes one real WordPress menu source; do not maintain duplicate menu datasets.
- WooCommerce owns product/cart/session/checkout/order state; Bricks owns presentation. Preserve Woo endpoints, nonces, notices, fragments, variations, forms, and lifecycle behavior.
- Product/post items reuse the existing shared normal renderer/layout across archive, taxonomy, related, featured, search, homepage, slider, and similar contexts unless the user explicitly requests a special variant.
- Frontend pages/components reuse the site's global design system for shell/gutters, typography, colors, spacing, radius, controls, shadows, and transitions. Do not invent page-local values when an equivalent token exists.
- Global `:root`/design tokens belong to `main.css`, `base.css`, `variables.css`, or the project's existing global layer; component stylesheets own component rules only.
- Use short functional filenames and existing project conventions. Avoid vague names such as `site-chrome`, junk version files, and overlapping override chains.
- Discover project data instead of hard-coding domain, prefix, IDs, Woo page IDs/slugs, menu locations, or discoverable taxonomies.
- Do not claim exact live database state unless a live DB-capable tool actually verified it.

## Progressive resource loading

The runtime routes only resources relevant to the task:

- `core-checklist.md` — compact checks for every task.
- `code-organization.md` — files/modules/assets/component ownership.
- `design-system.md` — frontend CSS, layout consistency, responsive visual system.
- `data-seeding.md` — generated data, concurrency-safe seed, duplicate repair, live-DB evidence.
- `templates.md` — Bricks template storage, conditions, archive/single/header/footer.
- `woocommerce.md` — WooCommerce-specific ownership and native flows.
- `migrations.md` — targeted Builder/DB migrations, element edits, rollback, CSS/cache transaction.
- `snippets.md` — implementation snippets for elements, menus, CSS/JS, AJAX and helpers.
- `patterns.md` — broader reusable architecture/implementation patterns.
- `validation.md` — full acceptance checklist only for broad audits/reviews; ordinary tasks use the compact checklist plus their domain resource.

Do not load every resource "just in case". Attached resources are mandatory; unattached resources are not required unless the task materially changes and routing must be reconsidered.

## Completion

Before reporting done, validate only what the task touched: syntax where executable, correct Bricks data/conditions when touched, generated CSS/cache after DB writes, responsive states for UI, preservation of unrelated Builder edits, no new duplicate data/layout/component, and no stale override/enqueue left after refactor.

If a required check cannot run because the connector lacks the capability, state that limitation exactly instead of reporting it as passed.
