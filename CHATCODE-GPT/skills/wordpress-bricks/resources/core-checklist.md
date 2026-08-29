# Compact core checklist

This is the only resource that should be loaded for every activated WordPress + Bricks task. Keep it short. Domain resources provide the detailed rules only when relevant.

## Before editing

- Inspect the real current project state; do not guess template IDs, Builder trees, page assignments, menus, Woo pages, prefixes, paths, or data ownership.
- **Search/Project Brain before source reads.** Brain may index broadly, but fetch content from the relevant child theme and directly related project-owned plugin first. Do not fill context with WordPress core, Bricks parent, Woo core, unrelated plugins, uploads, vendor/cache, or root files; widen scope only on concrete dependency/API evidence.
- Work only in the active child theme/custom plugin/Builder data intended for the task. Never edit WordPress core, Bricks parent theme, WooCommerce core, or vendor code.
- Prefer the smallest native solution: Bricks native element/control/template -> Bricks dynamic data / Query Loop / conditions -> WordPress/WooCommerce public API -> custom Bricks Element only for a proven native gap.
- Reuse existing clean project conventions, shared components, data sources, and global design tokens before creating parallel implementations.
- Preserve Builder/user edits. Existing Builder data is the source of truth after initial seed.

## During editing

- Make the smallest targeted patch and keep unrelated code/data untouched.
- Follow includes/imports/hooks/symbol references when more source is needed; expand retrieval one tier at a time instead of broad-scanning neighboring directories.
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
- no unrelated Builder edits lost;
- no stale override file/enqueue left behind after a refactor;
- no claim about live database state unless a live DB-capable tool actually verified it.

If a required validation command/tool is unavailable, state that limitation precisely instead of implying it passed.
