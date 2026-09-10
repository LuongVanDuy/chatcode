# Child-theme code organization & CSS ownership

Use this resource when creating, renaming, reorganizing, or refactoring child-theme files/assets. Follow a clean existing project convention first; otherwise use the ownership model below.

## Preferred WordPress + Bricks child-theme architecture

For new/clean projects, or intentional cleanup, prefer this shape **only when those responsibilities exist**:

```text
bricks-child/
├─ functions.php                 # bootstrap/enqueue only
├─ inc/
│  ├─ core/
│  │  ├─ helpers.php             # shared helpers
│  │  └─ templates.php           # shared Bricks template create/update/discovery helpers
│  ├─ setup/
│  │  ├─ media.php
│  │  └─ menus.php
│  └─ templates/
│     ├─ header.php
│     ├─ footer.php
│     └─ single-product.php
├─ elements/
│  ├─ product-support.php
│  └─ ...
└─ assets/css/
   ├─ main.css                   # ONLY tokens/base/global
   ├─ header-footer.css
   └─ single-product.css
```

Canonical owners: `inc/core/helpers.php`, `inc/core/templates.php`, `inc/setup/media.php`, `inc/setup/menus.php`, `inc/templates/header.php`, `inc/templates/footer.php`, `inc/templates/single-product.php`, `elements/product-support.php`.

Ownership:

- `functions.php` is the **thin entrypoint**: bootstrap/require modules and enqueue assets; no large feature/template/migration/helper implementations.
- `inc/core/helpers.php`: genuinely shared helpers. Feature-specific helpers stay with their owner.
- `inc/core/templates.php`: shared Bricks template discovery/create/update helpers, not one-off template content or arbitrary migrations.
- `inc/setup/`: registrations/setup such as media and menus.
- `inc/templates/`: template-specific code. Prefer `inc/templates/header.php` to vague `inc/setup/site-parts.php` when Header is the actual owner.
- `elements/`: reusable custom Bricks Elements only when a reusable/native-gap responsibility is proven.
- `assets/css/main.css`: only global tokens/base/site-wide rules; page/template/component CSS stays scoped.
- This is **not a scaffold checklist**. Do not create empty files/folders merely to complete the tree.
- Small tightly coupled responsibilities may remain together until a real separate owner exists.

## File naming

Use short functional names such as `helpers.php`, `templates.php`, `media.php`, `menus.php`, `header.php`, `footer.php`, `single-product.php`, `product-support.php`, `main.css`, `header-footer.css`, `single-product.css`, `home.css`.

Avoid vague defaults such as `site-chrome`, `site-parts`, `misc`, `stuff`, `common2`, `new`, `final`, `latest`, `v2`; do not prefix with `bricks-` merely because Bricks is used. Inspect current owners before creating parallel modules.

## File creation budget: correct owner first

A normal edit to an existing responsibility should usually create **zero new source files**. That default does not make the first existing/candidate file the owner and does not justify placing a new feature in `functions.php`.

| Situation | Expected decision |
| --- | --- |
| Change padding for a section already owned by `home.css` | Edit `home.css`; do not create another stylesheet |
| Fix the condition of an existing hook in `functions.php` | Fix that hook in place; do not split or refactor the theme just for the small change |
| New functionality already has a module with the same responsibility | Extend that functional module |
| New custom functionality has no suitable module | Use one minimal functional module only when the task allows it; keep bootstrap limited to require/enqueue |
| Bricks native can implement the behavior | Use native Bricks; do not generate custom PHP merely to create a cleaner module tree |
| The user explicitly restricts the change to a specific file | Respect that scope; report a concrete limitation if it cannot satisfy the task instead of expanding silently |

```text
identify the responsibility
-> small fix to existing code: edit its current owner in place, even when that code is in functions.php
-> suitable established functional module exists: extend it
-> new custom responsibility with no suitable module: use one minimal functional owner only when task scope allows
-> task card forbids the required new owner: resolve/report the mismatch through the existing task; do not bypass scope or stuff the feature into bootstrap
```

Do not create setup/helper/parts files merely to avoid editing an existing clean owner. Do not pair a normal feature with `*-migration.php`, or split one feature into `site-parts.php`, `site-parts-migration.php`, `site-parts-setup.php`. Initial implementation plus small tightly coupled setup may share one functional owner. Reuse a clean existing module even if its name differs from the preferred new-project tree. Do not scaffold `home`, `catalog`, `contact`, or `product` modules just because they appear in an example architecture.

## Global CSS belongs to the global layer

```text
style.css                    -> metadata/minimal entry
assets/css/main.css          -> global tokens/base
assets/css/header-footer.css -> header/footer only
page/component CSS           -> own scope
```

Global `:root`, typography/base, helpers, shell/gutters and site-wide values belong in `main.css`, `base.css`, `variables.css`, or the established equivalent. Component/page CSS must not own unrelated globals. Keep load order explicit and, when moving rules, update enqueues and remove duplicates atomically.

## Page CSS: group page-owned sections instead of file-per-section sprawl

If sections exist only on one page, that page stylesheet owns them:

```text
assets/css/home.css
/* Section 1 — Hero */
/* Section 2 — Featured products */
/* Section 3 — Product groups */
/* Section 4 — About tabs */
```

Do not create `home-section-2.css`, `home-section-3.css`, `home-section-4.css` only because there are multiple sections. Use `home.css`, `about.css`, `contact.css`, `recruitment.css`, etc. Split only when a component becomes truly reusable across pages/templates. Shared `product-card.css`/`post-card.css` stays with the shared item; page CSS owns only page composition.

JavaScript does **not** have to mirror CSS file grouping. Independent behavior may stay in files such as `home-product-groups.js`; small coupled behavior may remain in `home.js`.

## Reusable item layouts are the default

Normal repeated product/post presentation has one shared implementation across archive, taxonomy, related, featured, search, homepage and sliders unless a deliberate variant is requested.

- Search for an existing renderer/helper/partial/Bricks component/custom element first.
- Query/data and presentation are separate concerns: query/wrapper may differ while the item stays shared.
- Keep shared item CSS with the shared component.
- Grid/list/slider wrappers may differ without redefining the item.
- Consolidate duplicates while preserving current output and Builder edits.

## Quick acceptance

PASS:

```text
functions.php                    # thin bootstrap/enqueue entry
inc/core/templates.php           # shared Bricks template helpers
inc/setup/menus.php              # menu registration/setup
inc/templates/header.php         # Header-specific owner
inc/templates/footer.php         # Footer-specific owner
elements/product-support.php     # reusable custom Bricks element
assets/css/main.css              # global tokens/base
assets/css/header-footer.css     # Header/Footer presentation
assets/css/single-product.css    # Single Product presentation
assets/css/home.css              # homepage composition
```

FAIL:

```text
functions.php                    # large feature/template dump
assets/css/header-footer.css     # site-wide :root tokens
home-section-2.css
home-section-3.css
home-section-4.css               # page-only file sprawl
site-parts.php
site-parts-migration.php         # vague pair created for one normal feature
archive-product-item.php
featured-product-item.php        # duplicate normal card
```

Goal: **thin bootstrap; shared core helpers; scoped setup; template code in `inc/templates`; reusable Bricks elements in `elements`; global CSS stays global; page sections stay in the page layer; ordinary edits extend the correct functional owner instead of creating file sprawl or overloading `functions.php`.**
