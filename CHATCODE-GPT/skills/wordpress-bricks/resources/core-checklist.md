# Compact core checklist

Loaded for every WordPress + Bricks task. Keep it short; one domain resource supplies task-specific detail.

## Before editing

- Lock to the user-named target. Another project is read-only only when explicitly named as reference/copy/migration source.
- Inspect real current state; do not guess owners, template IDs, Builder trees, media assignments, menus, Woo pages, prefixes or paths.
- Search/Brain before reads. Read child-theme/project-owned code first; widen to Bricks/Woo/WP core only on concrete evidence.
- Keep external references scoped: when the user names a reference site/domain, use it first and do not broad-search unrelated websites for substitutes/inspiration unless that source is unavailable or the user asks for wider research.
- Existing owner before new file. Normal edit new-file budget is zero.
- Prefer Bricks native structure/dynamic data/API before a custom Bricks element. Normal container/grid/image/icon/text/button/slider/query-loop composition is not a custom-element gap.
- Preserve Builder/user edits and shared renderers/data sources.

## Naming and prefix

Use the discovered project prefix only where collision/storage/security identity matters: global PHP symbols, hooks/AJAX/nonces/asset handles, option/meta keys, custom element names and optionally one component root CSS class. Do not prefix private/local identifiers, labels, repeater keys, filenames or every descendant class.

## Media and icons

- Reference media must resolve by semantic slot and reference component: `slot -> selector/context -> source URL -> attachment ID -> allow_reuse`.
- Default `allow_reuse=false`; unresolved media remains unresolved. Do not silently reuse the first/closest image.
- Verify repeated items for accidental duplicate attachment IDs.
- Functional icons use Bricks Icon/icon controls or verified already-loaded icon classes. Brand marks/logos/certifications use real media/SVG assets.
- Do not inject `<i>` markup into ordinary text or keep large SVG data URIs in PHP.

## During editing

- Make the smallest targeted patch; owner sets may include a page/component owner plus a legitimate global companion such as `main.css`.
- Follow symbols/includes/hooks only when more source is needed; expand retrieval one tier at a time.
- Do not split a small feature into setup/helper/migration file families.
- A normal code/layout/template change is not a migration.
- Real persisted-data changes preserve Bricks IDs/relations/order and use recovery when material.
- One-time setup must terminate: explicit setup/admin/WP-CLI or guarded versioned migration, then no-op. It must not keep doing seed/import/template/media work on normal frontend `init`/`wp` requests.
- Reuse site-wide tokens only in the global CSS owner; page/component CSS owns its scope.

## Before reporting done

Validate touched scope only:

- PHP/JS syntax when executable;
- Bricks tree/template/conditions and Builder controls when touched;
- responsive UI when touched;
- no duplicate template/data/component/media assignment introduced;
- no unnecessary new source owner/custom element/migration;
- no one-time setup still performing work on frontend requests;
- no live DB/FTP/frontend claim unless a capable connected tool verified it.

If a required check cannot run, state the limitation instead of implying PASS.
