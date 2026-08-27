# Bricks + WooCommerce flow patterns

WooCommerce owns commerce state and lifecycle. Bricks owns presentation and template composition.

## General rule

For Shop/Product Archive, Single Product, Cart, Empty Cart, Checkout, Thank You, Mini Cart, Related/Upsell/Cross-sell:

1. inspect the active Bricks/Woo template and assigned Woo page;
2. prefer native Bricks Woo elements available in the installed version;
3. preserve WooCommerce forms, nonces, fragments, endpoints, variation logic, notices and order lifecycle;
4. use WooCommerce APIs/hooks for business logic;
5. avoid whole-template overrides for small visual changes.

## Product archive

Prefer a real `wc_archive` Bricks template.

Native composition should prefer:

- dynamic archive title;
- `woocommerce-products-archive-description`;
- `woocommerce-products` or another version-supported native Woo product/archive element consuming the archive main query.

Do not run a separate manual product-category query when the current archive main query already contains the intended products.

For generated conditions, discover product taxonomies. Do not assume only `product_cat` exists. Exclude internal taxonomies such as `product_type` and `product_visibility` from public archive condition generation.

## Single product

Prefer the installed Bricks Woo product elements and WooCommerce product object/API.

Preserve:

- variations and variation form state;
- add-to-cart quantity/button behavior;
- stock/purchasability rules;
- price/sale state;
- product gallery/image sizing;
- notices and hooks needed by third-party Woo integrations.

Do not duplicate product state into independent PHP variables/markup when the Woo object/native element already owns it.

## Cart

Prefer real Bricks cart templates and native elements such as:

- `woocommerce-cart-items`
- `woocommerce-cart-coupon`
- `woocommerce-cart-collaterals`

Use `wc_cart` for the populated cart template role and `wc_cart_empty` for empty-cart presentation when supported.

Do not implement a parallel cart state or manually recompute totals.

## Checkout

Prefer `wc_form_checkout` and native elements such as:

- `woocommerce-checkout-customer-details`
- `woocommerce-checkout-order-review`

Preserve Woo checkout field names, validation, nonces, AJAX refresh/order-review flow, payment methods and order creation lifecycle.

Do not hand-build a checkout form from Woo order/customer data unless the native/version-supported flow truly cannot satisfy the task.

## Thank You / Order Received

Prefer `wc_thankyou` plus `woocommerce-checkout-thankyou` when supported.

Do not query the order manually and recreate all Thank You HTML merely for layout. Custom additions should normally use Bricks layout around the native element or Woo hooks/API for the additional data only.

## Mini cart

Keep cart state in WooCommerce. Reuse native Bricks/Woo mini-cart behavior when available, including fragments/session behavior required by the active Woo version.

Do not create a second independent browser cart store just to display a header mini cart.

## Related, upsell, cross-sell

Prefer version-supported Bricks Woo elements or WooCommerce relationship APIs. Do not hard-code related product IDs unless explicitly required by the site's content model.

## Woo Blocks vs classic shortcodes

Modern WooCommerce may assign Cart/Checkout pages containing block markup while the project's verified Bricks `wc_cart` / `wc_form_checkout` path may require classic shortcode content.

Never migrate this by page slug/ID guess.

Resolve assigned pages:

```php
$cart_id     = wc_get_page_id('cart');
$checkout_id = wc_get_page_id('checkout');
```

Then inspect the current post content.

Migration is allowed only when all are true:

- the installed/project Bricks path has been verified to require classic shortcode rendering;
- the assigned page exists;
- current content actually contains the relevant Woo Cart/Checkout block;
- the target content can be identified without destroying unrelated custom content.

Before replacement:

- backup the exact original post content in a project-specific reversible migration record;
- detect custom/unrelated blocks/content;
- if mixed custom content cannot be safely preserved, stop/return conflict instead of overwriting.

Replace only the known Woo block-only content with the corresponding classic shortcode required by the verified setup. Store a migration marker. A second run must be a no-op.

Rollback restores the exact backed-up block content and clears relevant page/object cache.

## Woo page discovery

Prefer APIs instead of hard-coded routes/IDs:

```php
wc_get_page_id('shop');
wc_get_page_id('cart');
wc_get_page_id('checkout');
wc_get_page_id('myaccount');
wc_get_page_permalink('cart');
wc_get_page_permalink('checkout');
```

Use `get_page_by_path()` only when resolving a project-defined non-Woo page and no stronger stable ID/assignment exists.

## Query isolation

Any custom product query/filter must be scoped to the intended Bricks element/query/template.

Do not leak product filters into:

- wp-admin;
- REST/API requests unless intended;
- unrelated Query Loops;
- secondary widgets;
- other archives;
- checkout/cart requests.

Prefer query IDs/element IDs/context checks supported by the installed Bricks version.
