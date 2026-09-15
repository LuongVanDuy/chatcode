# WooCommerce domain

Use only when WooCommerce is detected and the task actually concerns Woo behavior/data, or when the user explicitly asks for WooCommerce behavior.

## Procedure

1. Use WooCommerce public APIs, hooks, canonical page IDs and Bricks Woo native elements/template semantics before custom replacements.
2. Generic words such as `product` or `shop` do not authorize Woo assumptions in a non-Woo CPT project.
3. Keep cart/session/checkout/order/account behavior owned by WooCommerce; Bricks/theme code integrates through supported extension points.
4. Preserve order/customer data and existing checkout semantics. Do not replace persisted content or Woo pages without proving the exact current target.
5. Reuse the project's shared product renderer when the task is visual/catalog-only and does not require a Woo behavior fork.
6. Do not read Woo core broadly unless a concrete API/template dependency requires it.

## Bricks 2.3.13 template coverage

Source-verified template types include product archive/single, cart/empty cart, checkout/pay/thank-you/order receipt, plus My Account login/lost/reset password, dashboard, orders/view order, downloads, addresses/edit address, edit account and payment-method templates.

Use the real persisted Bricks template type for the task. Normal WordPress Single remains `content`; Woo single product is `wc_product`.

## Verification

- Relevant Woo page/template/hook is resolved from current project evidence.
- Cart/checkout/order/account state still follows Woo behavior.
- Non-Woo CPT behavior is not accidentally converted to Woo assumptions.
- Builder-native Woo element/template ownership is not duplicated by a parallel PHP renderer without a proven gap.
