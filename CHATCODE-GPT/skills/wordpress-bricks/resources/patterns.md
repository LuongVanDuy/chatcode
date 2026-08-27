# Reusable WordPress + Bricks patterns

These patterns are project-independent. Adapt names, selectors, IDs and module paths to the current project after inspection.

## 1. Thin bootstrap, feature modules

`functions.php` should normally only load modules. A healthy pattern is:

```php
require_once __DIR__ . '/inc/setup/bootstrap.php';
require_once __DIR__ . '/inc/header/bootstrap.php';
require_once __DIR__ . '/inc/home/bootstrap.php';
require_once __DIR__ . '/inc/blog/bootstrap.php';
require_once __DIR__ . '/inc/shop/bootstrap.php';
require_once __DIR__ . '/inc/product/bootstrap.php';
```

Do not force these exact files when an equivalent project structure already exists. The rule is separation by concern, deterministic loading and no duplicated hook registration.

## 2. One-time seed controller

A seed routine should have a project-specific schema option such as `<prefix>_bricks_seed_version` and must check for existing intended templates/pages before creating anything.

Behavior:

```text
no marker + target absent -> seed -> verify -> write marker
marker exists -> do not seed
marker absent + target already exists -> adopt/inspect; do not overwrite
```

Never make normal `init` traffic rewrite the Builder tree on every request.

## 3. Stable semantic keys separate from Bricks IDs

When AI creates a tree that may need future migration, retain a code-side map of semantic roles to the IDs originally managed by the seed, for example:

```php
$managed = [
    'header_root' => 'abc123',
    'primary_nav' => 'def456',
    'cart_trigger' => 'ghi789',
];
```

The semantic key is for migration code; Bricks still owns the actual current Builder data. A migration must inspect whether the recorded ID still exists and whether the relevant managed value is unchanged before modifying it.

Do not use this map as permission to recreate the original tree.

## 4. Template lookup by role, not title alone

Template titles can be edited. Prefer a combination of stable post ID/seed metadata, Bricks template type and current template conditions. Before creating a template, inspect existing candidates and their conditions.

If multiple templates overlap, resolve the condition architecture instead of adding another duplicate template.

## 5. Targeted tree edit

For a setting update:

```text
load current tree
-> locate target element by stable ID/evidence
-> verify element name/expected old setting
-> clone only target element data
-> change one setting
-> write current tree with unrelated elements untouched
-> clean post cache
-> regenerate Bricks CSS when needed
-> write migration marker
```

For an ID update, modify reciprocal relations atomically and validate the tree before writing.

## 6. Builder edit wins

When a migration expected `gap=24px` because the original seed owned that value:

- current is `24px` -> migration may change it to the new managed value;
- current is already new value -> no-op and mark complete;
- current is `30px` -> assume user changed it, preserve `30px`, record skip/conflict, do not force the new default.

This compare-and-set rule applies to classes, labels, responsive settings, query options and similar managed values when possible.

## 7. Shared menu source

Use one WordPress menu location/menu ID as the content source. Desktop and mobile may use different Bricks responsive layout settings or render wrappers, but not different hand-maintained menu trees.

If a mobile drawer is needed, the menu inside it must still resolve the same registered WordPress menu source.

## 8. Header structure

A typical Bricks-native header should use native containers/blocks, logo/image, Nav Menu and Woo/cart elements where available. Keep menu state in WordPress and cart state in WooCommerce.

Before adding a hamburger, inspect whether the existing Nav Menu already provides mobile toggle behavior. Duplicate toggles are a common failure mode.

## 9. Home/blog modules

Homepage and blog work should separate data/query logic from layout styling.

- native Query Loop first;
- WordPress query filters only when the Bricks query cannot express the rule;
- scope query filters to the intended query ID/context;
- pagination/search/archive context must remain intact;
- do not globally alter `pre_get_posts` unless the main query is explicitly the intended target.

## 10. Shop/product modules

WooCommerce modules should use WooCommerce objects/functions/hooks for product, price, stock, cart and order state. Bricks handles layout; Woo handles commerce state.

For product grids:

- prefer Bricks/Woo product/query elements;
- scope sale/stock/category filtering to the target query;
- preserve ordering/pagination unless task requires changing them;
- use appropriate Woo image sizes instead of upscaling thumbnails.

For single products:

- use Woo product object/API;
- preserve variation/add-to-cart form behavior;
- related products should use Woo logic or a scoped Bricks query, not duplicated product IDs.

For cart/checkout/thank-you:

- preserve Woo endpoints, nonces, notices and order lifecycle;
- prefer hooks/native elements for small customizations;
- avoid replacing an entire Woo template for one visual block.

## 11. Custom Bricks element pattern

A custom element is appropriate when the component has reusable Builder controls plus behavior that native elements cannot express cleanly.

Keep these layers separate:

```text
element registration/class
-> Builder controls
-> query/data resolver
-> render method
-> scoped CSS/JS
-> AJAX endpoint only if needed
```

Use WordPress/Woo APIs in the data resolver. Do not hard-code project records into the element class.

## 12. AJAX pattern

For frontend mutations or dynamic loading:

- prefer native navigation/query behavior first;
- when AJAX is justified, use a project-specific action name;
- nonce-protect requests;
- capability-check privileged changes;
- sanitize request values;
- return `wp_send_json_success/error` or a verified REST response;
- do not return raw PHP warnings/notices;
- scope JS initialization so Bricks Builder/frontend rerenders do not double-bind listeners.

## 13. Conditional assets

Register/enqueue assets through WordPress. Load feature assets only on affected templates/pages when practical.

Examples of good scope evidence:

- page/template ID;
- `is_shop()`, `is_product()`, cart/checkout/order-received conditions;
- shortcode/block/element presence when reliably detectable;
- a custom Bricks element registering its own asset dependencies.

Avoid a single global CSS/JS bundle for unrelated one-off features.

## 14. CSS scope and layout safety

Prefer a project prefix plus component class, e.g. `.<prefix>-product-card`, not bare `.title`, `.button`, `.container` selectors.

Responsive-safe defaults:

```css
.component { min-width: 0; }
.component img { max-width: 100%; height: auto; }
.grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
```

Use breakpoints/native Bricks controls to reduce columns. Fixed heights are allowed only for an intentional crop/aspect-ratio design, not as a shortcut to align cards.

## 15. Cache/CSS completion

After a Bricks DB mutation, treat frontend verification as part of the write transaction:

```text
write current Bricks data
-> clean affected WP post cache
-> regenerate affected Bricks CSS when CSS-file mode requires it
-> clear relevant page/object cache
-> request frontend/build output
-> confirm the new element selector/style is present
```

A successful database write with stale frontend CSS is not a completed migration.
