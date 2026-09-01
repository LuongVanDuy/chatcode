# WordPress + Bricks Native Delivery

## Activation

Use this skill for every ChatCode task on a project that project evidence identifies as **WordPress + Bricks**. This skill is **mandatory** even when the user's prompt does not mention Bricks, templates, frontend work, or this skill.

Activate from inspected project state, never from prompt wording alone. Keep Bricks, Flatsome, and other theme/project conventions isolated. The request and current source define scope. Treat saved `project_rules` as durable decisions already confirmed by the user; do not reinterpret a targeted fix as permission to redesign, reorganize files, replace architecture, seed data, or change an agreed layout.

## Delivery order

Use the first level that fully satisfies the request:

1. **Bricks native element/control/template**.
2. **Bricks dynamic data / Query Loop / conditions**.
3. **WordPress or WooCommerce public API/hook**.
4. **Custom Bricks Element** only for a proven native gap.
5. **Shortcode wrapper** only for legacy compatibility or an explicit request.

A result that merely renders inside a Bricks page is not automatically Bricks-native. Normal editor-owned content must remain editable in Builder through native controls, dynamic data, or established project settings. A custom element must implement real controls and render from its settings; avoid fixed IDs, hidden render arrays, and PHP-only editor content.

## Fast task policy

- Start from the ranked files returned by `prepare_task`. Read more only when a missing dependency blocks a safe edit.
- Preserve the user's nouns and boundaries: header means header, one section means that section, and a font change does not authorize a CSS refactor.
- Use the existing owner for behavior/style. Do not create a second renderer, template, dataset, stylesheet, or override layer for the same responsibility.
- **A normal edit defaults to zero new source files.** Extend the clean existing owner first; create a file only for a genuinely independent/reusable responsibility with no suitable owner.
- Prefer one small patch and task-specific checks. Broaden into an audit/refactor only when requested or when concrete evidence makes the targeted fix unsafe.
- Never guess Bricks control APIs, template conditions, element IDs, database rows, live URLs, or asset paths. Inspect the installed implementation or use documented public APIs.
- Do not replace an agreed Builder structure with a different layout because another implementation is easier.

## Project scope and retrieval

`LOCK TARGET -> INSPECT -> identify real owner -> reuse project system -> smallest patch -> verify touched scope -> STOP`

When the user names one local project, stay on it. Cross-project reads require another project to be explicitly named as copy/migration/compare/reference source; references are read-only and mutation remains on the target.

Source retrieval is **scope-first**: Brain may index broadly, but fetch content from the relevant active child theme and directly related project-owned plugin first. Search/Brain before read; widen to Bricks parent, Woo/third-party core, or WordPress core only on concrete request/dependency/API evidence. Do not broad-read core, unrelated plugins, uploads, vendor/cache, or root files "just in case".

When the user names a specific external reference website/domain, use it as the primary external source. **Do not broad-search unrelated websites merely for inspiration.** Expand external research only when that named source is unavailable/insufficient for a required fact or the user explicitly asks for wider research/resources.

With modern Fast Agent tools, enter coding work through `prepare_task`; its returned `wordpress-bricks` contract is mandatory. With legacy ChatCode tools, inspect/read the target project first, then this skill from `CHATCODE-GPT`, then only task-relevant resources. Reading the skill for one project must not authorize another.

## Project ownership

- Builder/user-edited data is the source of truth after initial seed. Preserve unrelated elements, IDs, settings, sibling order, and user edits.
- Bricks owns presentation and Builder editability. WordPress owns posts, taxonomies, menus, media, users, and routing. WooCommerce owns product/cart/session/checkout/order/notices/endpoints/fragments/forms/variation state.
- A product-like CPT is **not WooCommerce** unless project evidence actually detects WooCommerce or the request explicitly says so. Never load/apply Woo rules merely because the request says product/sản phẩm.
- Reuse the current shared post/product item renderer across archive, taxonomy, related, featured, search, homepage, slider, and similar contexts unless a special variant is explicitly requested.
- Reuse the site's global shell, typography, colors, spacing, radius, controls, shadows, and transitions. Global tokens belong to the established global CSS layer; component/page files own only their scope.
- Follow existing functional filenames. Avoid vague buckets, numbered junk variants, file-per-section sprawl, and overlapping enqueue/override chains.
- Do not create vague file families such as `site-parts.php` + `site-parts-migration.php` for one normal feature.
- Discover prefixes, domains, IDs, slugs, menu locations, page assignments, and taxonomies instead of hard-coding them.

## Data changes

- **Migration has a threshold.** Normal code/layout/setup/template creation is not a migration. Use migration machinery only for already-persisted Builder/DB/content state that must be safely, idempotently upgraded while preserving user edits.
- Keep small coupled migration logic in the existing owner; create a dedicated migration module only for a proven independent/sequential migration lifecycle.
- Seeds/migrations must be idempotent, concurrency-safe, targeted, and use stable semantic identity. Re-query under a lock before creating records; repair only proven duplicates.
- Never overwrite a whole Builder tree to fix one section/field. Bricks tree changes preserve unique IDs, reciprocal `parent`/`children`, sibling order, and unrelated settings.
- Database/Builder-tree writes need recovery/backup when material and the required generated CSS/cache refresh.
- Generated template/page/post/menu data must not duplicate under concurrent requests.
- Desktop/mobile navigation consumes one real WordPress menu source; do not maintain duplicate menu datasets.
- Do not claim exact live database, FTP, or frontend state unless a capable connected tool verified that state.

## Progressive resource loading

The runtime always attaches `core-checklist.md`, then routes only the needed domain resources:

- `retrieval-scope.md` — evidence-driven source expansion and boundaries.
- `code-organization.md` — files/modules/assets/page ownership and new-file budget.
- `design-system.md` — UI consistency, layout, responsive CSS.
- `builder-editability.md` — controls, repeaters, custom elements, shortcode migration.
- `data-seeding.md` — generated records and duplicate prevention.
- `templates.md` — Bricks template storage and conditions.
- `woocommerce.md` — Woo-specific ownership/native flows only when Woo is relevant.
- `migrations.md` — real persisted Builder/database transformations, rollback/cache transaction.
- `snippets.md` and `patterns.md` — supporting implementation examples.
- `validation.md` — broad audit acceptance checks only.

For explicit requests, route primarily from request + detected project capability. For short referential follow-ups such as "sửa tiếp phần này", use ranked Project Brain/relevant-file evidence to recover the task domain without loading unrelated resources.

Do not load every resource just in case. Attached domain rules are mandatory for the current task. When context is tight, omit support/example resources before required rules.

## Completion

Before reporting done, verify only what changed. `complete_task` may infer PHP `php -l` and JavaScript `node --check` checks when explicit verification commands are omitted. Also check relevant Bricks tree/conditions, Builder editability, responsive states, generated CSS/cache, duplication, preservation of unrelated edits, **no unnecessary new file/migration module**, and no stale override/enqueue when those areas were touched.

Only send durable memory through `remember_project_rules` for a convention or correction the user explicitly confirmed. Do not store guesses, temporary task details, inferred preferences, secrets, URLs, credentials, or record IDs. If a required check cannot run, state that limitation exactly instead of reporting it as passed.
