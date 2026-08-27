# Real Bricks templates and archive patterns

This resource defines project-independent rules for creating and migrating real Bricks templates. Always inspect the installed Bricks version and current database/export shape before persistence.

## Real template storage

A Header/Footer/Archive/Single/Woo template is a real Bricks template, not a PHP page imitation.

When defined by the installed version, resolve/use:

- `BRICKS_DB_TEMPLATE_SLUG`
- `BRICKS_DB_TEMPLATE_TYPE`
- `BRICKS_DB_PAGE_CONTENT`
- `BRICKS_DB_HEADER`
- `BRICKS_DB_FOOTER`
- `BRICKS_DB_TEMPLATE_SETTINGS`

The operation must set the real Bricks template post/type metadata, store the element tree in the correct Bricks content context, store template settings, and apply precise template conditions.

Do not guess raw meta keys when the constants/current project code can resolve them.

## Content context

Map the changed tree to its actual rendering context:

- normal page/archive/single/Woo content tree -> `content` / `BRICKS_DB_PAGE_CONTENT` contract;
- Header template tree -> `header` / `BRICKS_DB_HEADER` contract;
- Footer template tree -> `footer` / `BRICKS_DB_FOOTER` contract.

Use the same context when regenerating generated CSS.

## Template condition examples

### Global Header/Footer

```php
[
    'templateConditions' => [
        ['main' => 'any'],
    ],
]
```

### Single Post

Semantic condition:

```text
main = postType
postType = ['post']
```

### Single Product

```text
main = postType
postType = ['product']
```

### Taxonomy archive

```text
main = archiveType
archiveType = ['term']
archiveTerms = [taxonomy::all]
archiveTermsIncludeChildren = true
```

Do not copy a taxonomy name from another project. Resolve the taxonomy actually needed.

### Blog archive

A blog/archive strategy may include term, author and date contexts when the intended design applies to each of them. Inspect existing conditions and prevent unintended overlap with more specific archive templates.

## Woo template types

When supported by the installed Bricks version, understand these roles:

```text
wc_archive
wc_cart
wc_cart_empty
wc_form_checkout
wc_thankyou
```

Use the current Bricks template contract rather than a custom PHP page that emulates one of these roles.

## Native archive main query

For WordPress archive/category/taxonomy templates, prefer the actual main archive query.

The native `posts` element should consume the archive main query when the installed Bricks contract supports `is_archive_main_query=true` or its version-equivalent setting.

Use dynamic data for archive title/description. Do not manually issue a second category/term query just to retrieve records already available in the main query.

## Product archive discovery

For `wc_archive`:

- use a dynamic archive title;
- prefer `woocommerce-products-archive-description` for Woo archive description;
- prefer `woocommerce-products` or the version-supported native Woo product element using the archive main query;
- discover product taxonomies with WordPress/Woo APIs;
- include only taxonomies appropriate for public frontend archive conditions;
- explicitly exclude internal taxonomies such as `product_type` and `product_visibility` from generic archive-condition generation.

Useful discovery APIs may include:

```php
get_object_taxonomies('product', 'objects');
wc_get_attribute_taxonomies();
```

Filter by actual public/queryable taxonomy properties instead of relying on a hard-coded category-only list.

## Single post native composition

Prefer:

```text
post-title
image + featured-image dynamic data
post-content (dataSource=wordpress when supported)
post-navigation
related-posts
```

Do not call `the_content()` in a second custom PHP block when native `post-content` already represents the source content.

## Template seed behavior

Template seed is first-run only:

```text
resolve existing template by project marker/current type+conditions
-> if absent, create real template + tree + settings + conditions
-> verify persistence
-> regenerate required CSS
-> write project-specific seed marker
```

If an existing intended template is found, inspect/adopt it. Do not rewrite its tree to match the current code defaults.

## Template migration behavior

Post-seed changes must target the existing template:

```text
load current tree/settings/conditions
-> locate exact managed target
-> compare current state with expected managed old state
-> patch only the required node/setting/condition
-> validate tree and condition overlap
-> backup when material
-> save
-> clean_post_cache
-> regenerate Bricks CSS with matching content/header/footer context when needed
-> write migration marker
```

Creating a replacement template is not a substitute for understanding the existing condition problem.
