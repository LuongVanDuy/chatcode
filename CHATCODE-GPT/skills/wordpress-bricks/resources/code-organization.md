# Child-theme code organization & CSS ownership

Use this resource when creating, renaming, reorganizing, or refactoring child-theme files/assets. Follow the project's clean existing convention first; otherwise prefer obvious functional ownership.

## File naming

Prefer short functional names:

```text
inc/setup/header-footer.php
inc/header/header.php
inc/footer/footer.php
assets/css/main.css
assets/css/header-footer.css
assets/css/product-card.css
assets/css/home.css
```

Rules:

- Name files after what they own: `header`, `footer`, `menu`, `product-card`, `checkout`, `home`, `main`.
- Do not use vague default names such as `site-chrome`, `misc`, `stuff`, `common2`, `new`, `final`, `latest`, `v2` unless the project intentionally uses that convention.
- Do not prefix files with `bricks-` merely because the site uses Bricks.
- Inspect existing files before creating another parallel module.
- Combine small tightly coupled responsibilities (`header-footer.php/css`); split only when responsibilities are genuinely independent.

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
assets/css/main.css          # global tokens/base
assets/css/home.css          # homepage section composition
assets/css/product-card.css  # reusable product item
```

FAIL:

```text
assets/css/header-footer.css # contains site-wide :root tokens
home-section-2.css
home-section-3.css
home-section-4.css           # all page-only, separately enqueued
archive-product-item.php
featured-product-item.php    # same normal card duplicated
```

Goal: **global things in the global layer; page-only sections in the page layer; reusable components in the component layer; repeated item presentation has one shared implementation; filenames describe responsibility.**
