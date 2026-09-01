# WooCommerce domain

Use only when WooCommerce is detected and the task actually concerns Woo behavior/data, or when the user explicitly asks for WooCommerce behavior.

## Procedure

1. Use WooCommerce public APIs, hooks, template semantics and canonical page IDs before custom replacements.
2. Generic words such as `product` or `shop` do not authorize Woo assumptions in a non-Woo CPT project.
3. Keep cart/session/checkout/order behavior owned by WooCommerce; Bricks/theme code should integrate through supported extension points.
4. Preserve order/customer data and existing checkout semantics. Do not replace persisted content or Woo pages without proving the exact target.
5. Reuse the project's shared product renderer when the task is visual/catalog-only and does not require a Woo behavior fork.
6. Do not read Woo core broadly unless a concrete API/template dependency requires it.

## Verification

- Relevant Woo page/template/hook is resolved from current project evidence.
- Cart/checkout/order state still follows Woo behavior.
- Non-Woo CPT behavior is not accidentally converted to Woo assumptions.
