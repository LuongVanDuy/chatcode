# Reusable WordPress + Bricks patterns

These patterns are project-independent. Discover IDs, prefixes, taxonomies, pages and data sources from the current project before adapting them.

## Thin bootstrap, feature modules

Keep `functions.php` small. Prefer existing equivalent modules; otherwise a healthy structure is:

```text
inc/setup/
inc/header/
inc/home/
inc/blog/
inc/shop/
inc/product/
inc/pages/
elements/
assets/css/
assets/js/
```

Typical bootstrap:

```php
require_once __DIR__ . '/inc/setup/bootstrap.php';
require_once __DIR__ . '/inc/header/bootstrap.php';
require_once __DIR__ . '/inc/home/bootstrap.php';
require_once __DIR__ . '/inc/blog/bootstrap.php';
require_once __DIR__ . '/inc/shop/bootstrap.php';
require_once __DIR__ . '/inc/product/bootstrap.php';
require_once __DIR__ . '/inc/pages/bootstrap.php';
```

Do not force duplicate folders/modules when the project already has clean equivalents.

## Native element selection

Before custom markup, map the UI requirement to Bricks-native elements:

```text
layout -> section/container/block
text -> heading/text-basic/text
CTA -> button
media -> image/slider
navigation -> nav-menu/search
blog archive -> posts + dynamic archive data
single post -> post-title/post-content/post-navigation/related-posts
product archive -> woocommerce-products + woocommerce-products-archive-description
cart -> woocommerce-cart-items/coupon/collaterals
checkout -> woocommerce-checkout-customer-details/order-review
thank you -> woocommerce-checkout-thankyou
```

Only fall through to custom element/API code when the installed version cannot express the required behavior cleanly.

## One-time seed controller

Use a project-specific seed marker and inspect existing targets before create:

```text
no marker + intended target absent -> create real Bricks/WP data -> verify -> marker
marker exists -> no seed
marker missing + target exists -> inspect/adopt -> no overwrite
```

Normal `init`/frontend traffic must never rewrite the Builder tree repeatedly.

## Semantic migration map, not source of truth

Code may keep project-owned semantic keys for items initially managed by the seed:

```php
$managed = [
    'header_root' => 'abc123',
    'primary_nav' => 'def456',
];
```

This map helps locate a migration target. It is not permission to recreate the original tree after Builder edits.

## Real template lookup

Do not identify templates by title alone. Combine the strongest available evidence:

- project-owned seed/meta marker;
- current template post ID;
- Bricks template type;
- current template conditions;
- current tree evidence.

Before creating a template, detect existing overlapping templates.

## Targeted tree edit

For a setting update:

```text
read current tree
-> locate exact element
-> verify expected managed old value
-> change only one setting
-> validate tree unchanged elsewhere
-> backup if material
-> save current tree
-> clean_post_cache
-> regenerate Bricks CSS when required
-> marker
```

For insert/delete/ID remap, update reciprocal parent/children atomically and preserve sibling order.

## Builder edit wins

Compare-and-set example:

```text
managed old = medium_large
managed new = large

current medium_large -> change
current large        -> already applied/no-op
current anything else -> preserve user edit; skip/conflict
```

Apply this rule to managed responsive values, classes, image sizes, query settings, labels and conditions whenever a stable old value exists.

## One WordPress menu source

Seed/register one real WordPress menu/location when needed. Desktop and mobile Bricks presentations resolve the same source.

Do not maintain duplicate item sets. If mobile uses a drawer, the drawer still points to the same registered menu/location.

If the user later edits/deletes seeded menu items, do not recreate defaults automatically.

## Archive main-query pattern

For category/taxonomy/author/date archive templates, prefer native main-query consumption:

```text
real Bricks archive template
-> dynamic archive title/description
-> posts element
-> archive-main-query setting (e.g. is_archive_main_query=true when supported)
```

Do not run another PHP category query when WordPress already built the archive main query.

## Product taxonomy discovery

Do not hard-code every product archive taxonomy.

Use current WordPress/Woo metadata, e.g. `get_object_taxonomies('product', 'objects')` and `wc_get_attribute_taxonomies()`, then retain public frontend archive taxonomies and reject internal ones such as `product_type` and `product_visibility`.

## Single post composition

Prefer native/dynamic source:

```text
post-title
image + featured-image dynamic data
post-content (WordPress data source)
post-navigation
related-posts
```

Do not duplicate post content in custom PHP markup.

## Woo ownership pattern

Bricks handles layout; WooCommerce owns state.

- product state -> Woo product object/API;
- cart totals/session -> Woo cart/session;
- checkout/order creation -> Woo checkout lifecycle;
- Thank You -> native Woo/Bricks order-received element;
- related/upsell/cross-sell -> Woo relations/native element.

Preserve Woo nonces, endpoints, fragments, forms and notices.

## Custom Bricks element layering

Use only when native elements cannot express the reusable behavior:

```text
class extends \Bricks\Element
-> Builder controls/defaults
-> WP/Woo data resolver
-> render
-> scoped CSS/JS
-> AJAX/REST only if required
```

Keep site-varying values in controls/dynamic data, not hard-coded in the class.

## Conditional assets

Use WordPress enqueue APIs and scope by actual render context/page when practical.

Use `filemtime($absolute_file)` for local development/cache busting when appropriate and the file exists.

Avoid frontend-only scripts/styles in Bricks Builder when they interfere with editing/preview; gate them using a verified Builder/editor context check for the installed version/project.

## Responsive-safe CSS

Prefer scoped selectors plus intrinsic sizing:

```css
.<prefix>-component { min-width: 0; max-width: 100%; }
.<prefix>-component img { max-width: 100%; height: auto; }
.<prefix>-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

Use deliberate `aspect-ratio`/`object-fit` only when crop behavior is intended. Do not use fixed card/banner heights merely to force alignment.

## Discovery before constants/data

Resolve project state rather than copying IDs/slugs:

```php
get_option('page_on_front');
wc_get_page_id('shop');
wc_get_page_id('cart');
wc_get_page_id('checkout');
wc_get_page_permalink('cart');
get_page_by_path($path);
get_nav_menu_locations();
get_object_taxonomies('product', 'objects');
wc_get_attribute_taxonomies();
```

Prefer stronger assignments/metadata over paths when available.

## Save + CSS/cache is one transaction

For Bricks DB changes:

```text
validated save
-> clean_post_cache($post_id)
-> Bricks template/cache refresh when needed
-> if cssLoading=file, generate_post_css_file with correct content/header/footer context
-> relevant page/object cache refresh
-> frontend verification
-> migration marker
```

A DB write with stale frontend CSS is incomplete.
