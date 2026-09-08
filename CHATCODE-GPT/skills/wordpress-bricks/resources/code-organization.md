# Child-theme ownership & naming

Use this only for file/layout ownership decisions. Prefer the project's clean existing convention; otherwise use the compact defaults below.

## Default shape

Create only responsibilities that actually exist:

```text
bricks-child/
├─ functions.php          # thin require/enqueue entry only
├─ inc/
│  ├─ init.php            # shared setup when needed
│  ├─ home.php            # Home-specific logic
│  ├─ header.php          # Header-specific logic when separate
│  └─ footer.php          # Footer-specific logic when separate
└─ assets/css/
   ├─ main.css            # global tokens/base/shared site rules
   ├─ home.css            # Home composition
   └─ header-footer.css   # only when Header/Footer need a separate lifecycle
```

Do not scaffold empty folders/files to match this tree.

## Existing owner first

```text
find current scoped owner
→ clean owner exists: edit it
→ only generic entry exists and responsibility is stable: create one short scoped owner
→ create another file only when lifecycle is genuinely independent
```

A normal edit should create zero files. Do not create `*-setup.php`, `*-helper.php`, `*-migration.php`, `*-v2.php` or per-section files just to avoid editing a clean owner.

## Short functional names

The theme/project folder already supplies project identity. Do not repeat brand/site names in every local file.

Prefer:

```text
main.css
home.css
overview.css
contact.css
checkout.css
single-product.css

init.php
home.php
overview.php
header.php
footer.php
templates.php
```

Avoid:

```text
mimosa-hotel-home.css
mimosa-hotel-shell.css
mimosa-hotel-home.php
home-section-2.css
home-slider-helper.php
site-parts.php
site-chrome.php
home-v2.css
```

`main`/`init` are valid shared-owner names. `shell`, `parts`, `misc`, `helper`, `new`, `final`, `latest`, `v2`, `section-1` are not default architectural names.

Keep ordinary basenames to roughly 1–3 semantic tokens. Add a project/brand prefix only when a real collision boundary requires it.

## CSS naming

Local CSS classes should describe page/component responsibility, not repeat the project name.

Prefer:

```css
.home-hero {}
.home-slider {}
.overview-intro {}
.product-card {}
```

Avoid:

```css
.mimosa-hotel-home-hero {}
.mimosa-hotel-overview-intro {}
.mimosa-hotel-home-hero-slider-inner-content {}
```

Keep ordinary local classes to roughly 1–3 semantic parts. Prefix only collision/global boundaries such as public PHP symbols, hook/asset handles, option/meta keys, custom Bricks Element names, or a proven shared component namespace.

## CSS ownership

```text
style.css         -> theme metadata/minimal entry
main.css          -> :root, typography/base, global tokens/shared rules
home.css          -> all Home-only sections
about.css         -> all About-only sections
component.css     -> only if reused across multiple pages/templates
```

Do not create one stylesheet per page section. Do not put page-only rules in `main.css`. Keep shared product/post card presentation in one shared owner.

## Acceptance

PASS:

```text
functions.php
inc/init.php
inc/home.php
assets/css/main.css
assets/css/home.css
```

FAIL:

```text
functions.php             # feature dump
assets/css/main.css       # page-specific dump
mimosa-hotel-home.php     # redundant project prefix
home-section-1.php
home-section-2.css
home-slider-helper.php
```

Goal: **few owners, short names, clear lifecycle, thin entrypoints, no brand-prefix repetition, no file-per-section sprawl.**
