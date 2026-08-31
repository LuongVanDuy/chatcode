# Compact core checklist

This is the only resource that should be loaded for every activated WordPress + Bricks task. Keep it short. Domain resources provide the detailed rules only when relevant.

## Before editing

- **Lock to the user-named target project.** Do not list, search, Brain-inspect, or read another shared project just to “look around”. Cross-project access is allowed only when the user explicitly asks to copy, migrate, compare, synchronize, or use another named project as a reference. Reference projects are read-only; mutation stays on the target project.
- Inspect the real current project state; do not guess template IDs, Builder trees, page assignments, menus, Woo pages, prefixes, paths, or data ownership.
- **Search/Project Brain before source reads.** Brain may index broadly, but fetch content from the relevant child theme and directly related project-owned plugin first. Do not fill context with WordPress core, Bricks parent, Woo core, unrelated plugins, uploads, vendor/cache, or root files; widen scope only on concrete dependency/API evidence.
- **Keep external references scoped.** If the user gives a specific reference website/domain, use that source first and do not broad-search unrelated websites “for ideas”. Expand external research only when the named source is unavailable/insufficient for a required fact, or when the user explicitly asks to research/find resources elsewhere.
- Work only in the active child theme/custom plugin/Builder data intended for the task. Never edit WordPress core, Bricks parent theme, WooCommerce core, or vendor code.
- Prefer the smallest native solution: Bricks native element/control/template -> Bricks dynamic data / Query Loop / conditions -> WordPress/WooCommerce public API -> custom Bricks Element only for a proven native gap.
- Reuse existing clean project conventions, shared components, data sources, and global design tokens before creating parallel implementations.
- **Existing owner before new file.** For a normal edit, the default new-file budget is zero: find and update the current functional owner first. Create a file only for a genuinely new independent responsibility or reusable component that has no clean existing owner.
- Preserve Builder/user edits. Existing Builder data is the source of truth after initial seed.

## During editing

- Make the smallest targeted patch and keep unrelated code/data untouched.
- Follow includes/imports/hooks/symbol references when more source is needed; expand retrieval one tier at a time instead of broad-scanning neighboring directories.
- Do not split one small feature into parallel setup/parts/migration files merely for architecture. Prefer one clear functional owner while responsibilities are tightly coupled.
- A normal code/layout/template edit is **not** a migration. Use migration machinery only when transforming persisted Builder/DB/content state that already exists and must be safely upgraded/idempotently re-run across deployments.
- For Bricks DB/tree changes, preserve unique IDs, reciprocal parent/children relations, sibling order, and unrelated settings.
- For generated/seeded data, make creation idempotent and concurrency-safe; never rely on a race-prone check-then-insert flow.
- For repeated product/post items, reuse the shared normal item renderer/layout unless the user explicitly requests a special variant.
- For frontend UI, reuse the site's shell, typography, colors, spacing, radius, controls, shadows, and transitions from the global design system.
- Do not hard-code project data that WordPress/Bricks/WooCommerce can discover.

## Before reporting done

Validate only the task-relevant scope:

- changed PHP/JS syntax when execution is available;
- correct Bricks template/tree/conditions when touched;
- CSS/cache regeneration after Bricks DB mutation when required;
- desktop/tablet/mobile for UI work;
- no duplicate template/data/component introduced;
- no unnecessary new owner/setup/migration file introduced;
- no unrelated Builder edits lost;
- no stale override file/enqueue left behind after a refactor;
- no claim about live database state unless a live DB-capable tool actually verified it.

If a required validation command/tool is unavailable, state that limitation precisely instead of implying it passed.
