# WordPress + Bricks Native Delivery

## Activation

This skill is **mandatory** when project evidence shows WordPress with Bricks or a Bricks child theme, even when the user's prompt does not mention Bricks. Activate from inspected project state, never from prompt wording alone. Keep Bricks, Flatsome, and other theme conventions isolated per project.

The request and current source define scope. Treat saved `project_rules` as durable decisions already confirmed by the user. Do not reinterpret a targeted fix as permission to redesign, reorganize files, replace architecture, seed data, or change a previously agreed layout.

## Delivery order

Use the first level that fully satisfies the request:

1. Bricks native element/control/template.
2. Bricks dynamic data / Query Loop / conditions.
3. WordPress or WooCommerce public API/hook.
4. Custom Bricks element when a real native gap remains.
5. Shortcode wrapper only for legacy compatibility or an explicit request.

A result that merely renders in a Bricks page is not automatically a Bricks-native solution. Normal content choices must remain editable in Builder through native controls, dynamic data, or existing project settings. A custom element must implement real controls and render from its settings; avoid fixed IDs, hidden arrays, and PHP-only editor content.

## Fast task policy

- Start from the ranked files returned by `prepare_task`. Read more only when a missing dependency blocks a safe edit.
- Preserve the user's nouns and boundaries: header means header, one section means that section, and a font change does not authorize a CSS refactor.
- Use the existing owner for the behavior or style. Do not create a second renderer, template, dataset, stylesheet, or override layer for the same responsibility.
- Prefer one small patch and task-specific checks. Broaden into an audit or refactor only when requested or when concrete evidence makes the targeted fix unsafe.
- Never guess Bricks control APIs, template conditions, element IDs, database rows, live URLs, or asset paths. Inspect the installed implementation or use documented public APIs.
- Do not replace agreed Builder structure with a different layout because another approach is easier to code.

## Project ownership

- Builder/user-edited data is the source of truth after initial seed. Preserve unrelated elements, IDs, settings, sibling order, and user edits.
- Bricks owns presentation and Builder editability. WordPress owns posts, taxonomies, menus, media, users, and routing. WooCommerce owns product, cart, session, checkout, order, notices, endpoints, fragments, forms, and variation behavior.
- A product-like CPT is not WooCommerce unless the project actually uses WooCommerce or the request explicitly says so. Do not load or apply Woo rules to a catalog CPT that explicitly excludes WooCommerce.
- Reuse the current shared post/product item renderer across archive, taxonomy, related, featured, search, homepage, and slider contexts unless a special variant is explicitly requested.
- Reuse the site's global shell, typography, colors, spacing, radius, controls, shadows, and transitions. Global tokens belong to the existing global CSS layer; component/page files own only their scope.
- Follow existing functional filenames. Avoid vague buckets, numbered junk variants, file-per-section sprawl, and overlapping enqueue/override chains.
- Discover prefixes, domains, IDs, slugs, menu locations, page assignments, and taxonomies instead of hard-coding them.

## Data changes

Seeds and migrations must be idempotent, concurrency-safe, and targeted. Use stable semantic identity, re-query under a lock before creating records, and preserve current Builder data. Repair only proven duplicates. Database and Builder-tree writes need a recovery path and the required CSS/cache refresh.

Do not claim exact live database or frontend state unless a capable tool verified that state.

## Progressive resource loading

The runtime always attaches `core-checklist.md`, then routes only the needed domain resources:

- `retrieval-scope.md`: evidence-driven source expansion.
- `code-organization.md`: modules, assets, ownership, and enqueues.
- `design-system.md`: UI consistency and responsive CSS.
- `builder-editability.md`: controls, repeaters, custom elements, and shortcode migration.
- `data-seeding.md`: generated records and duplicate prevention.
- `templates.md`: Bricks templates and conditions.
- `woocommerce.md`: Woo-specific flows only.
- `migrations.md`: targeted Builder/database repair and rollback.
- `snippets.md` and `patterns.md`: supporting implementation examples.
- `validation.md`: broad audit acceptance checks only.

Do not load every resource just in case. Attached domain rules are mandatory for the current task. When context is tight, omit support examples before required rules.

## Completion

Before reporting done, verify what changed. `complete_task` will infer PHP and JavaScript syntax checks when explicit commands are omitted. Also check relevant Bricks tree/conditions, Builder editability, responsive states, generated CSS/cache, duplication, and preservation of unrelated edits when those areas were touched.

Only send durable memory through `remember_project_rules` for a convention or correction the user explicitly confirmed. Do not store guesses, temporary task details, inferred preferences, secrets, URLs, credentials, or record IDs. If a required check cannot run, report that limitation instead of claiming success.
