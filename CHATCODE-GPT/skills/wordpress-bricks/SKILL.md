# WordPress + Bricks Native Delivery

Use this skill for every ChatCode task on a project that project evidence identifies as **WordPress + Bricks**. In that case this skill is **mandatory**, even when the user's prompt does not mention Bricks, templates, frontend work, or this skill.

Do not activate it merely because a prompt mentions Bricks; the project itself must provide WordPress + Bricks evidence such as theme profile, child-theme `Template: bricks`, Bricks paths, or equivalent Project Brain evidence.

Keep work Bricks-native, editable in Builder, project-focused, and as small as the task allows. Detailed rules live in routed resources and should be read only when attached to the task.

## Core decision order

Choose the smallest valid solution:

1. **Bricks native element/control/template**.
2. **Bricks dynamic data / Query Loop / conditions**.
3. **WordPress or WooCommerce public API/hook**.
4. **Custom Bricks Element** only for a proven native gap.

Do not build parallel PHP/HTML behavior when the installed Bricks/Woo stack already owns it.

## Mandatory workflow

`LOCK TARGET -> INSPECT -> identify real render/data owner -> reuse project system -> smallest patch -> backup when material -> implement -> refresh generated state when needed -> validate relevant scope`

Inspect enough current state to avoid guessing: active child theme/custom plugin, relevant Bricks/Woo state, current page/template, Builder tree/conditions, shared components, data ownership, design tokens, and migration/cache state when relevant.

Source retrieval is **scope-first**: Brain may index broadly, but fetch source from the relevant child theme and directly related project-owned plugin first. Search/Brain before read; widen to Bricks parent, Woo/third-party core, or WordPress core only on concrete request/dependency/API evidence.

When the user names one local project, stay on it. Cross-project reads require another project to be explicitly named as copy/migration/compare/reference source; references are read-only and mutation remains on the target.

When the user names a specific external reference website/domain, use it as the primary external source. **Do not broad-search unrelated websites merely for inspiration.** Expand external research only when that source is unavailable/insufficient for a required fact or the user explicitly asks for wider research/resources.

With modern Fast Agent tools, enter coding work through `prepare_task`; its `wordpress-bricks` contract is mandatory. With legacy ChatCode tools, inspect/read the target project first, then this skill from `CHATCODE-GPT`, then only task-relevant resources. Reading the skill for one project must not authorize another.

## Non-negotiable rules

- Never edit WordPress core, Bricks parent theme, WooCommerce core, or vendor code.
- **Index broadly; fetch narrowly.** Do not broad-read core, unrelated plugins, uploads, vendor/cache, or root files "just in case".
- **Existing owner before new file. A normal edit defaults to zero new source files.** Extend the clean functional owner first; create a file only for a genuinely new independent/reusable responsibility with no suitable owner.
- Do not create vague file families such as `site-parts.php` + `site-parts-migration.php` for one normal feature. Use short functional names and split only on real ownership/lifecycle boundaries.
- Current Builder/user-edited data is source of truth after initial seed. Never overwrite a whole Builder tree for a small update.
- Real Header/Footer/Archive/Single/Woo work uses real Bricks templates/current storage and conditions, not fake PHP pages.
- Bricks tree changes preserve unique IDs, reciprocal `parent`/`children`, sibling order, and unrelated settings.
- Prefer native Bricks sections; if a custom element is justified, editor-owned content/data must use suitable Builder controls/dynamic data rather than hard-coded arrays/IDs.
- **Migration has a threshold.** Normal code/layout/setup/template creation is not a migration. Use migration machinery only for already-persisted Builder/DB/content state that must be safely, idempotently upgraded while preserving user edits. Keep small coupled migration logic in the existing owner; create a dedicated migration module only for a proven independent/sequential migration lifecycle.
- Generated template/page/post/menu data must not duplicate under concurrent requests; use stable semantic identity and concurrency-safe creation.
- After real Bricks DB mutation, refresh relevant cache/generated CSS when required by the installed setup.
- Desktop/mobile navigation consumes one WordPress menu source; do not maintain duplicate menu datasets.
- WooCommerce owns product/cart/session/checkout/order state; Bricks owns presentation. Preserve Woo lifecycle behavior.
- Product/post items reuse the existing shared normal renderer/layout across contexts unless a special variant is explicitly requested.
- Frontend components reuse the site's global design system; do not invent page-local values when equivalent tokens exist.
- Global `:root`/design tokens belong to the established global CSS layer; component stylesheets own component rules only.
- Discover project data instead of hard-coding domain, prefix, IDs, Woo page IDs/slugs, menu locations, or discoverable taxonomies.
- Do not claim exact live database state unless a live DB-capable tool verified it.

## Progressive resource loading

The runtime routes only task-relevant resources:

- `core-checklist.md` — compact checks for every task.
- `retrieval-scope.md` — source discovery/fetch boundaries.
- `code-organization.md` — files/modules/assets/page ownership and new-file budget.
- `design-system.md` — frontend layout/design consistency.
- `builder-editability.md` — custom controls/configurable Builder content.
- `data-seeding.md` — generated data, safe seed/duplicate repair.
- `templates.md` — Bricks template storage/conditions.
- `woocommerce.md` — Woo ownership/native flows.
- `migrations.md` — only real persisted Builder/DB/content transformations, rollback/cache transaction.
- `snippets.md` — implementation snippets.
- `patterns.md` — reusable architecture patterns.
- `validation.md` — full checklist only for broad audits/reviews.

For explicit requests, route primarily from the request. For short referential follow-ups such as "sửa tiếp phần này", use ranked Project Brain/relevant-file evidence to recover the domain without loading unrelated resources.

Resource loading uses a soft context budget. **Never drop a selected mandatory domain rule to satisfy that budget.** Omit support/examples such as `snippets.md` or `patterns.md` first; required domain resources remain authoritative.

**Do not load every resource "just in case".** Attached resources are mandatory; unattached resources are not required unless the task materially changes.

## Completion

Validate only what the task touched: syntax where executable, Bricks data/conditions, Builder editability, generated CSS/cache after DB writes, responsive UI, preservation of unrelated Builder edits, no duplicate data/layout/component, **no unnecessary new file/migration module**, and no stale override/enqueue after refactor.

If a required check cannot run, state that limitation exactly instead of reporting it as passed.
