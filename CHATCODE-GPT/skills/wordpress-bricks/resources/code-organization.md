# Child-theme code organization & CSS ownership

Use these rules when the task creates, renames, reorganizes, or refactors child-theme files/assets. Prefer the current project's established clean convention; optimize for obvious responsibility rather than clever terminology.

## File naming: short, functional, obvious

Name files after what they actually own. A developer should understand the file's purpose without knowing an internal nickname.

Prefer names such as:

```text
inc/setup/header-footer.php
inc/header/header.php
inc/footer/footer.php
assets/css/main.css
assets/css/base.css
assets/css/header-footer.css
assets/css/header.css
assets/css/footer.css
```

Rules:

- Prefer concise functional nouns: `header`, `footer`, `menu`, `product-card`, `checkout`, `main`, `base`.
- Do not invent vague umbrella terms for ordinary site parts. In particular, do **not** use `site-chrome` as the default name for header/footer/navigation code.
- Avoid junk/version names such as `misc`, `stuff`, `common2`, `new`, `final`, `latest`, `v2` unless the project already has a deliberate migration/versioning convention.
- Do not prefix a file with `bricks-` merely because the site uses Bricks. Use it only when the file specifically distinguishes Bricks behavior from another implementation.
- Before creating a new file, inspect existing folders/files and reuse or extend the closest clean equivalent instead of creating a parallel naming system.
- If header and footer are still small and tightly coupled, `header-footer.php` / `header-footer.css` is acceptable. Split to `header/`, `footer/`, `header.css`, `footer.css` when responsibilities become independent.

## Global CSS belongs to the global layer

Global design tokens and root-level rules must live in a global stylesheet, not inside a component stylesheet.

Preferred ownership:

```text
style.css                    -> WordPress child-theme metadata + minimal theme entry/base when appropriate
assets/css/main.css          -> global tokens/base rules
# or assets/css/base.css     -> global tokens/base rules
assets/css/header-footer.css -> Header/Footer component styles only
assets/css/header.css        -> Header styles only
assets/css/footer.css        -> Footer styles only
```

Mandatory rules:

- Put global `:root` custom properties/design tokens in `main.css`, `base.css`, `variables.css`, or the project's existing equivalent global layer.
- Do **not** put site-wide `:root` variables, global reset, body typography, generic global helpers, or unrelated components inside `header.css`, `footer.css`, `header-footer.css`, `product-card.css`, or another feature stylesheet.
- Component-specific custom properties may live on the component root selector, e.g. `.<prefix>-header { --header-height: ...; }`, instead of polluting global `:root`.
- A component stylesheet should be removable without unexpectedly deleting unrelated global styling.
- Keep CSS load order explicit: theme/base entry first, then global `main.css`/`base.css`, then component/page styles.
- When refactoring, move existing global rules to the global layer and update enqueue order/paths atomically; do not leave duplicate declarations in both files.

Example load order:

```text
style.css
-> assets/css/main.css
-> assets/css/header-footer.css
-> page/component CSS as needed
```

## Page CSS: group page-owned sections instead of file-per-section sprawl

When several sections belong only to one page, the default CSS owner is the page stylesheet, not one stylesheet per numbered section.

Preferred homepage shape:

```text
assets/css/home.css

/* Section 1 — Hero */
/* Section 2 — Featured products */
/* Section 3 — Product groups */
/* Section 4 — About tabs */
```

Rules:

- Do not create `home-section-2.css`, `home-section-3.css`, `home-section-4.css`, etc. merely because the page has multiple sections.
- Keep page-only section CSS together in `home.css`, `about.css`, `contact.css`, `recruitment.css`, or the project's equivalent page owner.
- Inside the page file, use clear section comments/order so the file remains easy to navigate.
- If a section later becomes a genuinely reusable component across multiple pages/templates, move its styling to a functional shared component stylesheet such as `product-card.css`, `tabs.css`, or the project's existing equivalent. Do not keep both copies.
- Shared item CSS such as the normal product card/post card remains owned by the shared component even when used on the homepage; the page stylesheet owns the page wrapper/section composition around it.
- Do not split CSS solely to make a file look shorter. Split by **ownership/reuse boundary**, not by section number.
- When consolidating old section CSS, remove the old enqueue registrations and old files only after confirming their rules have been migrated; do not leave duplicate cascade layers.

JavaScript does **not** have to mirror CSS file grouping. Feature-specific JS may remain separate when behavior/state is independent or complex, for example:

```text
assets/js/home.js
assets/js/home-product-groups.js
assets/js/home-about-tabs.js
```

But avoid pointless JS fragmentation too: if a small section behavior is tightly coupled to the page and has no independent lifecycle, keeping it in `home.js` is cleaner.

## Reusable item layouts are the default

Repeated content cards/items must have one shared presentation implementation unless the user explicitly asks for a special layout.

This applies especially to:

- product item / product card;
- post item / article card;
- related products/posts;
- featured products/posts;
- archive and taxonomy listings;
- search results;
- homepage sections;
- sliders/carousels that render the same item type;
- query-loop sections that differ only by data source/filter.

Mandatory rules:

- Before creating item markup, inspect the project for an existing reusable renderer, helper, partial, Bricks component/template, custom element, or shared item tree.
- **Data/query and presentation are separate concerns.** Different pages may use different queries, filters, limits, sorting, sliders, or wrappers while rendering the same shared item layout.
- A product item that already exists for the main product list must be reused for related products, featured products, taxonomy results, search results, and other normal product collections.
- A post item that already exists for blog/archive output must be reused for related posts, category/tag listings, search results, and other normal post collections.
- Do not copy/paste the same card markup into multiple page modules and then maintain slightly different versions by accident.
- Do not create page-specific functions such as separate archive/related/featured renderers when one shared item renderer plus arguments/modifiers can express the difference cleanly.
- Small contextual differences should use explicit parameters, data, modifier classes, or wrapper-level CSS rather than duplicating the full item layout.
- Keep item CSS owned by the shared component (`product-card.css`, `post-card.css`, or the project's existing equivalent), not duplicated inside every page stylesheet.
- If a special visual variant is truly required, create it only when the user explicitly requests a different layout or the current project already defines a deliberate named variant. Do not infer a special variant merely because the item appears on another page.
- When duplicate implementations already exist, prefer consolidating them carefully into the established shared renderer while preserving current output and Builder edits.

Preferred shape:

```text
query/filter for archive ─┐
query/filter for related ─┼─> shared product item renderer/layout
query/filter for featured ┤
query/filter for slider  ─┘

query/filter for blog    ─┐
query/filter for related ─┼─> shared post item renderer/layout
query/filter for search  ─┘
```

The wrapper may change (`grid`, `list`, `slider`) without redefining the item itself.

## Acceptance examples

PASS:

```text
inc/setup/header-footer.php
assets/css/main.css          # :root + global tokens
assets/css/header-footer.css # only header/footer selectors
```

PASS for one-page section ownership:

```text
assets/css/home.css
# owns homepage section wrappers/composition
# shared product-card.css still owns the reusable product item
```

PASS when split is warranted:

```text
inc/header/header.php
inc/footer/footer.php
assets/css/main.css
assets/css/header.css
assets/css/footer.css
```

PASS for product reuse:

```text
archive query  -> shared product item
related query  -> shared product item
featured query -> shared product item
slider query   -> shared product item
```

FAIL:

```text
inc/setup/site-chrome.php
assets/css/site-chrome.css
assets/css/header-footer.css # contains site-wide :root tokens
```

FAIL for page CSS fragmentation:

```text
home-section-2.css
home-section-3.css
home-section-4.css
# all only belong to the same homepage and have separate enqueues for no reuse reason
```

FAIL for repeated item layouts:

```text
archive-product-item.php
related-product-item.php
featured-product-item.php
# same normal product card copied three times
```

The goal is not one rigid folder template. The goal is predictable ownership: **global things in the global layer; page-only sections in the page layer; reusable components in the component layer; repeated item presentation has one shared implementation; filenames describe the actual responsibility.**
