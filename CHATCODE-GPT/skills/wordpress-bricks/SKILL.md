# WordPress + Bricks Native Delivery

Use this skill for WordPress projects rendered with Bricks Builder, especially WooCommerce sites. The implementation must stay Bricks-native, editable in Builder, preserve user Builder edits, and remain independent of any reference website or project.

## 1. Bricks-native first

Choose the smallest solution in this order:

1. **Bricks native element/control/template**.
2. **Bricks dynamic data / Query Loop / template condition**.
3. **WordPress or WooCommerce public API/hook**.
4. **Custom Bricks Element** only when the native stack is insufficient for reusable behavior, special query/AJAX, or domain logic.

Do not build a parallel PHP/HTML layout when Bricks already has an appropriate element.

Know and prefer native elements when supported by the installed Bricks version, including:

`section`, `container`, `block`, `heading`, `text-basic`, `text`, `button`, `image`, `nav-menu`, `search`, `slider`, `posts`, `post-title`, `post-content`, `post-navigation`, `related-posts`, `woocommerce-products`, `woocommerce-products-archive-description`, `woocommerce-cart-items`, `woocommerce-cart-coupon`, `woocommerce-cart-collaterals`, `woocommerce-checkout-customer-details`, `woocommerce-checkout-order-review`, `woocommerce-checkout-thankyou`, plus other Bricks WooCommerce elements available in the active version.

Never edit WordPress core, the Bricks parent theme, WooCommerce core, or vendor code.

## 2. Mandatory safety workflow

Every WordPress + Bricks task follows:

`INSPECT -> identify active child theme/plugins/Bricks/Woo -> find the page/template actually rendering -> read current Bricks tree -> choose native element/feature -> choose smallest patch -> backup if DB migration -> implement -> targeted migration -> regenerate Bricks CSS/cache -> validate PHP/JS -> responsive QA`

INSPECT is mandatory. Do not guess the current tree, template ID, page assignment, taxonomy, menu, Woo page, or rendering path.

Before changing anything, determine the relevant current state:

- active child theme and custom plugin/module locations;
- Bricks version and whether the feature/element/API exists in that version;
- whether WooCommerce is active and which Woo pages are assigned;
- current post/template ID and template type actually rendering the request;
- current element tree (`id`, `name`, `parent`, `children`, `settings`);
- template conditions and Query Loop/main-query behavior;
- current Builder edits, seed markers, migration markers;
- current WordPress nav menu location/source;
- Bricks CSS loading mode and relevant caches;
- existing custom elements and feature CSS/JS to avoid duplicates.

## 3. Bricks data model

Treat Bricks content as an ordered element tree, never as generic HTML.

Each element has:

- `id`
- `name`
- `parent`
- `children`
- `settings`

Preserve these invariants:

- IDs are stable and unique inside the tree.
- New generated element IDs use the native Bricks six-character alphanumeric shape unless the installed version proves a different contract.
- Never generate an ID that already exists in the current tree.
- `parent` and `children` must stay reciprocal and preserve sibling order.
- `settings` changes are local to the intended element.
- Changing an ID requires an atomic remap of the element `id`, its parent's `children`, direct children's `parent`, and only proven settings/relations that store that ID.
- Never global string-replace an element ID through serialized content.

Before writing Bricks DB data, validate unique IDs, existing parents/children, reciprocal relations, and unchanged unrelated siblings/settings.

## 4. Real Bricks templates, not fake PHP pages

Header, Footer, Archive, Single and Woo templates must be real Bricks templates stored using the active Bricks database contract.

When available in the installed version, use/resolve the Bricks constants for the correct storage role:

- `BRICKS_DB_TEMPLATE_SLUG`
- `BRICKS_DB_TEMPLATE_TYPE`
- `BRICKS_DB_PAGE_CONTENT`
- `BRICKS_DB_HEADER`
- `BRICKS_DB_FOOTER`
- `BRICKS_DB_TEMPLATE_SETTINGS`

Set the correct template type and conditions. Do not create a fake WordPress Page/PHP template to imitate a Bricks template.

Condition patterns the skill must understand:

```text
Global Header/Footer:
templateConditions => [['main' => 'any']]

Single Post:
main=postType
postType=['post']

Single Product:
main=postType
postType=['product']

Taxonomy archive:
main=archiveType
archiveType=['term']
archiveTerms=[taxonomy::all]
archiveTermsIncludeChildren=true
```

Blog archive may intentionally include term, author and date contexts.

WooCommerce Bricks template types include, when supported by the installed version:

`wc_archive`, `wc_cart`, `wc_cart_empty`, `wc_form_checkout`, `wc_thankyou`.

Before creating a template, inspect existing templates and conditions. Resolve overlap instead of creating duplicate Header/Footer/Archive/Single/Woo templates.

Read `resources/templates.md` for storage/condition patterns.

## 5. Seed once; Builder is source of truth

Automatically created template/page/menu content may be seeded only once.

- Store a project-specific seed key/meta marker identifying what the skill created.
- If the intended template/page/menu already exists, inspect/adopt it; do not overwrite its whole tree/content.
- After the user edits content in Bricks Builder, the current Builder data is the source of truth.
- Never use “layout version increased” as permission to rewrite an existing Builder tree for a small update.
- Never recreate deleted/edited seeded menu items automatically after the initial seed.

Seed routines must be idempotent and must not rewrite Builder data on normal frontend/admin requests.

## 6. Targeted migrations only after seed

Every post-seed Bricks DB change must be a small targeted migration:

`load current tree -> locate exact element by stable ID/class/name + surrounding evidence -> verify precondition -> patch only target setting/node -> repair parent/children if structure changed -> validate tree -> backup when material -> save -> regenerate Bricks CSS/cache -> write migration marker`

Rules:

- migration is idempotent;
- marker/version advances only after the complete operation succeeds;
- unrelated Builder edits must survive;
- if changing a managed setting, use compare-and-set semantics;
- change the value only when the current value still equals the old value originally managed by the skill;
- if the user changed it in Builder, preserve the user value and return skipped/conflicted rather than force the new default.

Example: migrate `imageSize` from `medium_large` to `large` only when the current value is still `medium_large`.

Read `resources/migrations.md`.

## 7. Deleting an element

Never reseed a template merely to remove one element.

To delete a Bricks element:

1. load the current tree;
2. locate the exact target and retain the removed ID;
3. decide explicitly whether descendants are deleted, reparented, or the operation must abort;
4. remove only the intended element/subtree;
5. remove the deleted ID(s) from the parent's `children`;
6. keep sibling order/settings unchanged;
7. validate no dangling `parent`/`children` references remain;
8. backup first when the migration is material;
9. save, regenerate required CSS/cache, then write the migration marker.

## 8. Bricks CSS + cache is part of the write

A Bricks DB mutation is not complete until generated frontend state matches the saved tree.

After a successful write:

- call `clean_post_cache($post_id)`;
- refresh the affected Bricks template/cache when needed;
- if `\Bricks\Database::get_setting('cssLoading') === 'file'`, regenerate the affected generated CSS using `\Bricks\Assets_Files::generate_post_css_file(...)` with the correct context for the changed document (`content`, `header`, or `footer`) and the signature supported by the installed Bricks version;
- clear only relevant page/object/plugin caches when possible;
- verify the frontend no longer serves stale generated CSS.

Treat **save tree + CSS regeneration/cache refresh** as one operation. Do not mark a migration complete when CSS regeneration failed.

## 9. WordPress nav menus are real data

Header/Footer navigation must use a real WordPress nav menu source using WordPress APIs such as:

- `register_nav_menus()`
- `wp_create_nav_menu()` for first seed only
- `wp_update_nav_menu_item()` for first seed/explicit menu migration only
- `get_nav_menu_locations()` / `nav_menu_locations`

Desktop and mobile may render differently, but they must consume the same WordPress menu source/location.

Do not create two independently maintained desktop/mobile menus. Do not create a duplicate hamburger if the active Bricks `nav-menu` already owns mobile toggle behavior.

If the user edits/deletes seeded menu content later, do not silently recreate defaults.

## 10. Archive patterns

### Blog/category/archive

Use a real Bricks Archive template and the WordPress main archive query whenever it already represents the required dataset.

- prefer the native `posts` element;
- use `is_archive_main_query=true` where that is the installed Bricks contract for consuming the current archive main query;
- use dynamic data for archive title/description;
- do not manually query the current category/term in PHP when the main archive query already provides it.

### Woo product archive

Use a real `wc_archive` template.

- archive title is dynamic;
- archive description prefers `woocommerce-products-archive-description`;
- product output prefers `woocommerce-products`/native archive-capable element consuming the archive main query;
- discover public product taxonomies instead of hard-coding category/attribute taxonomy names where possible;
- exclude internal/non-public taxonomies such as `product_type` and `product_visibility` from template-condition discovery.

Read `resources/templates.md` and `resources/woocommerce.md`.

## 11. Single post

Prefer native Bricks elements/dynamic data:

- `post-title`
- featured image via native image/dynamic data
- `post-content` with `dataSource=wordpress` when that is the installed Bricks contract
- `post-navigation`
- `related-posts`

Do not duplicate WordPress post content by rendering another PHP copy.

## 12. WooCommerce ownership and Bricks presentation

WooCommerce owns product/cart/session/checkout/order business logic. Bricks owns layout/presentation.

The skill must understand the native Bricks/Woo flow for:

- Shop/Product Archive
- Single Product
- Cart
- Empty Cart
- Checkout
- Thank You / Order Received
- Mini cart
- Related/Upsell/Cross-sell

Prefer native Bricks Woo elements available in the active version. In particular:

- Thank You: prefer `woocommerce-checkout-thankyou`, not custom order-query HTML;
- Checkout: prefer `woocommerce-checkout-customer-details` and `woocommerce-checkout-order-review` when supported;
- Cart: prefer native cart items/coupon/collaterals elements;
- preserve Woo endpoints, nonces, notices, fragments, variations and order lifecycle semantics.

Do not replace a whole WooCommerce template for one small visual change.

Read `resources/woocommerce.md`.

## 13. Woo Blocks vs Bricks templates

Modern WooCommerce may assign Cart/Checkout pages containing Blocks while a Bricks `wc_cart` / `wc_form_checkout` setup needs classic shortcodes in the project/version being used.

If a migration is required:

1. resolve the assigned Woo page with `wc_get_page_id()`;
2. inspect the current page content;
3. migrate only when the content truly contains the relevant Woo Cart/Checkout block and the verified Bricks setup requires classic shortcode rendering;
4. backup the original block content;
5. replace only the known block-only content with the corresponding classic shortcode;
6. if unrelated/custom content exists, do not overwrite it blindly;
7. store a migration marker and enough backup data for reversal;
8. make the migration idempotent and reversible.

Never hard-code Cart/Checkout page IDs or slugs when Woo APIs can resolve them.

## 14. Custom Bricks elements

Create a custom element only when native Bricks cannot cleanly express the required reusable component, special query/AJAX, or Woo-specific behavior.

A custom element must:

- extend `\Bricks\Element`;
- expose meaningful Builder controls;
- define reasonable defaults;
- keep site-varying content/settings editable in Builder;
- render using WordPress/WooCommerce APIs;
- escape output;
- use scoped project-specific classes;
- nonce/capability-check mutations/AJAX;
- avoid hard-coded project IDs/content when controls or discovery can supply them;
- avoid duplicate JS bindings after Builder/frontend rerenders.

## 15. Child-theme architecture

Prefer modular feature boundaries, adapting to an equivalent existing project structure when present:

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

`functions.php` should remain a thin loader/registration/enqueue bootstrap, not a multi-thousand-line feature implementation.

## 16. Assets

CSS/JS should be split by page/component and conditionally enqueued when practical.

- use WordPress enqueue APIs;
- use `filemtime()` as a local asset version when appropriate and the file exists;
- do not load unrelated feature bundles on every page;
- avoid running frontend-only assets inside Bricks Builder when they conflict with Builder editing/preview;
- scope CSS selectors with a project/component prefix;
- localize only required public data; never secrets.

## 17. Responsive completion

Every UI task must be checked at desktop, tablet and mobile.

Avoid:

- hard/fixed widths causing overflow;
- fixed heights that break/crop banners without an explicit design need;
- stretched grid cards creating large empty areas;
- undersized thumbnails being upscaled and blurred;
- duplicate hamburger/menu systems;
- mobile menu data diverging from desktop;
- product cards overflowing the viewport.

Prefer native Bricks responsive controls and scoped CSS using patterns such as `minmax(0, 1fr)`, `width:100%`, `max-width`, deliberate `aspect-ratio`, appropriate `object-fit`, and component-scoped media queries.

## 18. Discover; do not hard-code project data

Do not hard-code values that WordPress/Bricks/WooCommerce can discover:

- domain;
- project prefix;
- post/template/attachment/term IDs;
- phone/address or content unrelated to the task;
- taxonomy names when public product taxonomies can be discovered;
- page paths when assigned pages can be resolved by API.

Prefer discovery such as:

- `page_on_front`
- `wc_get_page_id()`
- `wc_get_page_permalink()`
- `get_page_by_path()`
- `get_nav_menu_locations()`
- `get_object_taxonomies()`
- `wc_get_attribute_taxonomies()`

Derive/reuse a short prefix from the current child theme/plugin/project identity. Never copy a prefix from another project.

## 19. Completion contract

Use `resources/validation.md` before reporting done. For the task-relevant scope verify:

- real Bricks template/data model when templates are involved;
- correct tree IDs/parent/children/settings;
- native element chosen when available;
- correct template type/conditions;
- seed-once and Builder-preserving behavior;
- idempotent targeted migration and backup where material;
- CSS/cache regeneration after Bricks DB changes;
- shared WordPress menu source for desktop/mobile;
- native Woo flow for Cart/Checkout/Thank You/archive/single where supported;
- archive main query rather than redundant manual query;
- scoped assets;
- desktop/tablet/mobile;
- no project-specific hard-coded data;
- PHP/JS syntax for changed code.
