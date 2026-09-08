# Real Bricks templates

Use native Bricks templates for Header/Footer/Archive/Single/Woo roles. Do not emulate a Bricks template with a custom PHP page.

## Resolve before create

Template creation must be idempotent. Before any create, resolve the intended template in this order:

```text
known persisted template ID / project marker
→ matching Bricks template type
→ matching or overlapping template conditions
→ normalized title as a last fallback
```

If a compatible template already exists, adopt/update it. Do not create another template because a marker is missing or a seed version changed.

For Header/Footer/Archive/Single templates, a same-type template with equivalent/overlapping conditions is a conflict to inspect, not permission to seed another copy.

## Storage and context

Use the installed Bricks version's real constants/contracts when available, including:

- `BRICKS_DB_TEMPLATE_SLUG`
- `BRICKS_DB_TEMPLATE_TYPE`
- `BRICKS_DB_PAGE_CONTENT`
- `BRICKS_DB_HEADER`
- `BRICKS_DB_FOOTER`
- `BRICKS_DB_TEMPLATE_SETTINGS`

Do not guess raw meta keys when current Bricks/project code can resolve them.

Match content context when saving/regenerating CSS:

```text
normal page/archive/single/Woo -> content
Header template                 -> header
Footer template                 -> footer
```

## Seed lifecycle

One-time setup is exactly that:

```text
resolve intended template
→ found: adopt and stop/create no duplicate
→ absent: create once
→ verify persisted tree/settings/conditions
→ persist stable ID/marker
→ future runs: no-op or targeted update
```

Do not keep seed/create work on ordinary frontend requests after success.

## Targeted updates

After initial creation:

```text
load existing template by stable identity
→ patch only managed nodes/settings/conditions
→ preserve user-edited/unrelated Builder content
→ validate tree + condition overlap
→ save/cache/CSS refresh only when required
```

Creating a replacement template is not a migration strategy.

## Conditions

Use precise conditions and inspect overlap before save.

Common semantics:

```text
Global Header/Footer: main = any
Single Post:          main = postType, postType = post
Single Product:       main = postType, postType = product
Taxonomy archive:     main = archiveType, archiveType = term
```

Do not copy taxonomy/condition values from another project.

## Native query/composition

For archives, prefer the native archive main query rather than issuing a duplicate query for records WordPress already resolved. For single content, prefer native Bricks elements/dynamic data instead of a second custom `the_content()` path.

For Woo templates, use the installed Bricks-supported roles such as `wc_archive`, `wc_cart`, `wc_cart_empty`, `wc_form_checkout`, and `wc_thankyou` when applicable.

Goal: **one semantic template per role/condition, stable identity, native storage, targeted updates, no duplicate seeds.**
