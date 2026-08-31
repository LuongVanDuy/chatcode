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

## File creation budget: existing owner first

A normal change should usually create **zero new source files**.

```text
search current owner
-> clean owner exists: edit it
-> established functional module fits: use it
-> genuinely independent/reusable responsibility: create one clear owner
-> multiple new files only for proven separate lifecycles
```

Do not create setup/helper/parts files merely to avoid editing an existing clean owner. Do not pair a normal feature with `*-migration.php`, or split one feature into `site-parts.php`, `site-parts-migration.php`, `site-parts-setup.php`. Initial implementation plus small tightly coupled setup may share one functional owner. Reuse a clean existing module even if its name differs from the preferred new-project tree.

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

Goal: **thin bootstrap; shared core helpers; scoped setup; template code in `inc/templates`; reusable Bricks elements in `elements`; global CSS stays global; page sections stay in the page layer; ordinary edits extend existing owners instead of creating file sprawl.**
