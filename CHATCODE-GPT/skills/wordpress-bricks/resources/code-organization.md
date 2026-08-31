# Child-theme code organization & CSS ownership

Use this resource when creating, renaming, reorganizing, or refactoring child-theme files/assets. Follow the project's clean existing convention first; otherwise prefer obvious functional ownership.

## Preferred WordPress + Bricks child-theme architecture

For a new/clean Bricks child theme, or when deliberately cleaning up a messy project, prefer this shape when the corresponding responsibilities actually exist:

```text
bricks-child/
├─ functions.php                 # bootstrap/enqueue only
├─ inc/
│  ├─ core/
│  │  ├─ helpers.php             # shared helpers
│  │  └─ templates.php           # shared Bricks template create/update/discovery helpers
│  ├─ setup/
│  │  ├─ media.php               # media/image-size setup
│  │  └─ menus.php               # menu registration/setup
│  └─ templates/
│     ├─ header.php              # Header-specific template ownership
│     ├─ footer.php              # Footer-specific template ownership
│     └─ single-product.php      # Single Product-specific template ownership
├─ elements/
│  ├─ product-support.php        # reusable custom Bricks element
│  └─ ...                        # product-card, CTA, other proven reusable elements
└─ assets/css/
   ├─ main.css                   # ONLY tokens/base/global
   ├─ header-footer.css          # Header/Footer presentation
   └─ single-product.css         # Single Product presentation
```

Ownership contract:

- `functions.php` is the thin entrypoint: require/bootstrap modules and enqueue assets. Do not turn it into a feature dump, template renderer, migration bucket, or large helper library.
- `inc/core/helpers.php` holds genuinely shared project helpers used across more than one feature/domain. Feature-specific helpers stay with their owner.
- `inc/core/templates.php` holds shared Bricks template discovery/create/update utilities. It is **not** a place for one-off template content, per-template UI, or arbitrary migrations.
- `inc/setup/` owns site setup/registration concerns such as menus and media. Do not put Header/Footer implementation into a vague setup file.
- `inc/templates/` owns template-specific project code such as Header, Footer, Archive, Single Product, etc. Prefer `inc/templates/header.php` over vague `inc/setup/site-parts.php` when Header is the real responsibility.
- `elements/` owns reusable custom Bricks Element classes/components. Create one only for a proven reusable/native-gap responsibility; do not wrap ordinary static layout in PHP just to have an element file.
- `assets/css/main.css` owns only global tokens/base/site-wide rules. Template/page/component CSS stays with its scope.
- This tree is a preferred ownership model, **not a scaffold checklist**. Do not create empty `helpers.php`, `media.php`, `menus.php`, template files, element files, or CSS files merely to make the tree look complete.
- Small projects may keep tightly coupled responsibilities together until a real independent owner exists. Refactor into this shape when it reduces ambiguity, duplication, or file sprawl—not for aesthetics alone.

## File naming

Prefer short functional names:

```text
inc/core/helpers.php
inc/core/templates.php
inc/setup/media.php
inc/setup/menus.php
inc/templates/header.php
inc/templates/footer.php
inc/templates/single-product.php
elements/product-support.php
assets/css/main.css
assets/css/header-footer.css
assets/css/single-product.css
assets/css/home.css
```

Rules:

- Name files after what they own: `header`, `footer`, `menu`, `product-card`, `checkout`, `home`, `main`.
- Do not use vague default names such as `site-chrome`, `site-parts`, `misc`, `stuff`, `common2`, `new`, `final`, `latest`, `v2` unless the project intentionally uses that convention.
- Do not prefix files with `bricks-` merely because the site uses Bricks.
- Inspect existing files before creating another parallel module.
- Combine small tightly coupled responsibilities; split only when responsibilities are genuinely independent.

## File creation budget: existing owner first

A normal change should usually create **zero new source files**.

Decision order:

```text
search current owner
-> clean owner exists: edit it
-> no owner: can the change fit an established functional module? use it
-> genuinely new independent/reusable responsibility: create one clear owner
-> multiple new files only when each has a proven separate lifecycle/responsibility
```

Rules:

- Do not create a new setup/helper/parts file just to avoid editing an existing clean owner.
- Do not pair a normal feature file with a `*-migration.php` file by default.
- Do not split one small feature into `site-parts.php`, `site-parts-migration.php`, `site-parts-setup.php`, etc.
- Initial implementation and its small tightly coupled setup may live together in the functional owner.
- Separate PHP/JS/CSS assets when their runtime/lifecycle genuinely differs, not because every section deserves a file.
- Before adding a second new file for one request, state internally what independent responsibility requires it; if none exists, keep the implementation together.
- Reuse or extend a clean existing module even if its filename is not the hypothetical filename you would choose for a new project.

## Global CSS belongs to the global layer

Preferred ownership:

```text
style.css                    -> child-theme metadata/minimal entry
assets/css/main.css          -> global tokens/base rules
# or base.css/variables.css  -> existing global equivalent
assets/css/header-footer.css -> header/footer only
page/component CSS           -> its own scope only
```

Mandatory:

- Global `:root` tokens, reset/base typography, generic helpers, site shell/gutters and other site-wide values live in `main.css`, `base.css`, `variables.css`, or the established global equivalent.
- Do not place those global rules in `header.css`, `footer.css`, `product-card.css`, or page CSS.
- Component-only variables may live on the component root selector.
- A component stylesheet should be removable without deleting unrelated global styling.
- Keep load order explicit: `style.css -> main/base -> component/page CSS`.
- When moving rules, update enqueue paths/order atomically and remove duplicates.

## Page CSS: group page-owned sections instead of file-per-section sprawl

If several sections exist only on one page, the page stylesheet owns their composition.

```text
assets/css/home.css
/* Section 1 — Hero */
/* Section 2 — Featured products */
/* Section 3 — Product groups */
/* Section 4 — About tabs */
```

- Do not create `home-section-2.css`, `home-section-3.css`, `home-section-4.css`, etc. only because the homepage has several sections.
- Use `home.css`, `about.css`, `contact.css`, `recruitment.css`, or the project's equivalent page owner.
- Organize long page CSS with clear section comments/order.
- Split a section into a component stylesheet only when it becomes genuinely reusable across pages/templates.
- Shared item CSS such as `product-card.css` or `post-card.css` stays with the shared item; `home.css` owns only the homepage wrapper/composition around it.
- Split by ownership/reuse boundary, not by section number or file length.
- When consolidating old section CSS, migrate all rules, remove old enqueues, then remove old files; do not leave cascade duplicates.

JavaScript does **not** have to mirror CSS file grouping. Independent/complex behavior may stay split:

```text
assets/js/home.js
assets/js/home-product-groups.js
assets/js/home-about-tabs.js
```

Small tightly coupled behavior may remain in `home.js`; avoid fragmentation without an independent lifecycle.

## Reusable item layouts are the default

Normal repeated product/post items use one shared presentation implementation unless the user explicitly requests a special variant.

Applies to archive, taxonomy, related, featured, search, homepage sections, sliders/carousels and similar query contexts.

Rules:

- Inspect for an existing renderer/helper/partial/Bricks component/custom element before writing item markup.
- **Query/data and presentation are separate concerns.** Queries, filters, limits, ordering and wrappers may differ while the item layout remains shared.
- Product archive/related/featured/taxonomy/search/slider should reuse the normal product item; blog/category/tag/related/search should reuse the normal post item.
- Do not create separate page-specific renderers when one shared renderer plus arguments/modifier classes can express the difference.
- Keep shared item CSS with the shared component, not copied into each page stylesheet.
- A grid/list/slider wrapper may differ without redefining the item.
- Create a new item variant only when the user explicitly requests one or the project already has a deliberate named variant.
- When duplicate implementations exist, consolidate carefully while preserving current output and Builder edits.

Preferred shape:

```text
archive query  ─┐
related query  ─┼─> shared product item
featured query ─┤
slider query   ─┘

blog query     ─┐
related query  ─┼─> shared post item
search query   ─┘
```

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
assets/css/home.css              # homepage section composition
```

FAIL:

```text
functions.php                    # contains large feature/template implementations
assets/css/header-footer.css     # contains site-wide :root tokens
home-section-2.css
home-section-3.css
home-section-4.css               # all page-only, separately enqueued
site-parts.php
site-parts-migration.php         # vague pair created for one normal feature
archive-product-item.php
featured-product-item.php        # same normal card duplicated
```

Goal: **thin bootstrap; core helpers shared; setup registrations scoped; template code in `inc/templates`; reusable Bricks elements in `elements`; global CSS stays global; page-only sections stay in the page layer; repeated item presentation has one shared implementation; ordinary edits extend existing owners instead of creating file sprawl.**
