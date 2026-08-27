# WordPress + Bricks Native Delivery

Use this skill for WordPress projects that use Bricks Builder, especially when WooCommerce is present. The goal is to preserve Builder ownership, make the smallest safe change, and keep implementation Bricks-native.

## Non-negotiable priority

Choose solutions in this order:

1. Bricks native element/control/template/query feature.
2. WordPress or WooCommerce public API/hook.
3. Bricks dynamic data, query loop, condition, global class, variable, or template feature.
4. A custom Bricks element only when the native stack cannot express the reusable behavior cleanly.

Do not build a parallel PHP/HTML UI system when Bricks already has a suitable element. Never edit WordPress core, the Bricks parent theme, WooCommerce core, or vendor code.

## Mandatory workflow

Every implementation follows this sequence:

`INSPECT -> identify current Bricks data/template -> choose smallest solution -> patch -> targeted migration if needed -> regenerate Bricks CSS/cache -> validate PHP/JS -> responsive QA`

INSPECT is mandatory. Before changing code or Bricks data, determine:

- active child theme/plugin custom-code locations;
- whether Bricks is the active parent/theme stack;
- affected post/template IDs and template type;
- current element tree (`id`, `name`, `parent`, `children`, `settings`);
- template conditions and query-loop settings;
- whether content has already been edited in Builder;
- CSS loading mode and relevant cache layers;
- existing menu source, WooCommerce flow, custom elements, CSS and JS modules.

Never assume the original seed is still authoritative after Builder edits.

## Bricks data model

Treat a Bricks layout as an ordered element tree, not generic HTML. Preserve these invariants:

- element `id` is unique within the document/template;
- `name` identifies the Bricks element type;
- `parent` points to the containing element or root;
- `children` preserves the ordered child IDs expected by the current Bricks data format;
- `settings` contains only settings owned by that element;
- template type and template conditions stay consistent with the template role;
- dynamic data and query-loop expressions stay native when possible;
- when changing one element, do not rewrite unrelated siblings, settings, classes or conditions.

Before mutating serialized/database Bricks data, inspect the actual installed Bricks version or a current Builder export/data sample. Do not guess undocumented keys, value shapes or internal APIs from memory when the live project can prove them.

## Seed once, Builder is truth

AI-created pages/templates may be seeded only once.

After the first successful seed:

- Builder data is the user's source of truth;
- do not reseed the whole page/template to fix one detail;
- do not reconstruct the initial tree and overwrite user edits;
- future changes must be targeted migrations or normal Builder-compatible code changes.

A seed routine must be idempotent and guarded by a project-specific marker/version. A second run must not replace an existing seeded template merely because the code's default structure changed.

## Targeted migration contract

After seed, a Bricks-data change must:

1. locate the exact template/page and target element by stable evidence;
2. verify the current element/setting still matches the migration's expected precondition;
3. change only the required setting, ID relation, condition or child reference;
4. preserve every unrelated Builder edit;
5. record a project-specific migration marker/version only after success;
6. be safe to run again with no additional mutation.

Prefer compare-and-set semantics: replace a managed old value only when the current value still equals that old value. If the user changed it, preserve the user value and mark the migration as skipped/conflicted rather than forcing the new default.

For ID migrations, update all affected reciprocal references atomically: the element ID, its parent's `children`, child `parent` values and any settings/selectors/relations that genuinely reference that ID. Never global-search-and-replace an ID across unrelated content.

See `resources/migrations.md` for the reusable strategy.

## CSS and cache after Bricks data mutation

If Bricks is configured to use generated CSS files, database mutations affecting element styles/classes/settings are not complete until the affected Bricks CSS is regenerated using an API/path verified for the installed Bricks version.

After a successful data mutation:

- clean the affected WordPress post cache;
- regenerate affected Bricks CSS when required by the site's CSS mode;
- clear only relevant object/page/plugin caches when possible;
- avoid broad destructive cache flushes unless necessary;
- verify frontend output no longer references stale CSS.

Do not call an undocumented Bricks internal method blindly. Detect the installed version/class/method or reuse the project's proven regeneration helper.

## WordPress-native menus

Navigation must use a real WordPress menu assignment/source. Desktop and mobile presentations must consume the same menu source; responsiveness belongs to presentation, not duplicated content.

Do not create a second menu, second hamburger or duplicate menu tree just to implement mobile. Prefer the Bricks Nav Menu element/native responsive controls. If custom rendering is required, use the same registered menu/location and WordPress menu APIs.

## Templates and conditions

Use the correct Bricks template role and exact conditions for:

- Header
- Footer
- Page/content templates
- Archive/search/blog templates
- Single post templates
- WooCommerce product archive
- WooCommerce single product
- cart
- checkout
- thank-you/order received
- reusable sections/popups when appropriate

Before creating a new template, inspect existing templates and conditions to avoid duplicates. Never solve a condition bug by creating another overlapping Header/Footer/Archive/Single template unless the intended architecture truly requires it.

## WooCommerce

Keep business state in WooCommerce. Use WooCommerce products, cart/session/order APIs, hooks and Bricks/WooCommerce elements rather than duplicating product/order/cart state in custom markup.

For product archive/single/cart/checkout/thank-you/mini-cart/related-products work:

- inspect the active Bricks WooCommerce template and conditions first;
- prefer Bricks native Woo elements and Woo APIs;
- preserve Woo form names, nonces, endpoints, fragments and order lifecycle semantics;
- do not override entire WooCommerce templates for a small visual change;
- scope query changes to the intended Bricks query/main query only;
- do not make an archive query filter leak into admin, REST, unrelated loops or other pages.

## Custom Bricks elements

Create a custom Bricks element only for reusable component/query/AJAX behavior that native Bricks does not express cleanly.

A custom element must:

- expose meaningful controls in Builder;
- read content/settings through element controls, dynamic data or WP/Woo APIs;
- render scoped markup/classes;
- escape output correctly;
- use nonces/capability checks for mutations/AJAX;
- enqueue assets only where the element/feature is used when practical;
- avoid project-specific hard-coded IDs, URLs, menu items, product IDs or content unless explicitly required.

## Module architecture

Keep `functions.php` as a small bootstrap. Organize implementation by concern, adapting to the existing project rather than forcing folders that already have equivalents:

```text
inc/setup/
inc/header/
inc/home/
inc/blog/
inc/shop/
inc/product/
elements/
assets/css/
assets/js/
```

Load modules deterministically and avoid duplicate registrations/hooks. Prefer one setup/bootstrap module for one-time seed/migration wiring and small feature modules for runtime behavior.

## Assets

CSS and JS must be scoped to the component/page/template and conditionally enqueued when practical.

- no global CSS selectors that unintentionally restyle all Bricks elements;
- no inline giant style/script blocks in PHP when a module asset is clearer;
- use unique project-specific handles/classes/prefixes;
- localize only the data a script needs;
- do not expose secrets in localized data;
- reuse native Bricks/WP/Woo frontend behavior instead of duplicating it.

## Responsive is part of completion

Every visual implementation must be checked at desktop, tablet and mobile.

Avoid:

- fixed widths that overflow the viewport;
- fixed heights that distort/crop content without an explicit design reason;
- flex/grid children that cannot shrink (`min-width: 0` issues);
- accidental grid stretch;
- unnecessary low-resolution image upscaling;
- duplicate mobile menu/hamburger systems;
- breakpoint-only markup duplication when the same semantic content can be restyled.

Prefer intrinsic dimensions, responsive Bricks controls, appropriate image sizes, `height:auto` for normal media, and deliberate `object-fit`/aspect-ratio only where cropping is intended.

## Prefix policy

Derive a short, project-specific prefix from the child theme/plugin/project identity. Check existing functions/classes/handles first and reuse the established project prefix when one exists.

Never import a prefix from another project. The prefix must apply consistently to PHP functions/classes, option/migration markers, asset handles, custom element names/slugs and scoped CSS/JS selectors where applicable.

## Completion checklist

Before reporting done, verify the relevant items in `resources/validation.md`. At minimum confirm:

- smallest patch used;
- no core/parent-theme/vendor edits;
- no full reseed of an already-seeded template;
- migration idempotency/precondition if Bricks data changed;
- CSS/cache refresh if Bricks data affected styling;
- PHP/JS syntax for changed files;
- template/menu/query/Woo behavior relevant to the task;
- desktop/tablet/mobile behavior for visual changes.
