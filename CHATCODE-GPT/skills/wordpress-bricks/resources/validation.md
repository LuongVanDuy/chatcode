# WordPress + Bricks acceptance validation

Run only checks relevant to the changed skill/feature. Do not rerun unrelated ChatCode Stage 1–4, tunnel, updater or installer regressions for a skill-only change.

## A. Inspect before implementation

PASS only if:

- [ ] active child theme/custom plugin locations are identified;
- [ ] Bricks and WooCommerce activation/version evidence is known when relevant;
- [ ] the real page/template currently rendering is identified;
- [ ] current Bricks tree/settings/conditions are read before DB mutation;
- [ ] existing seed/migration markers are inspected;
- [ ] current menu source and assigned Woo pages are discovered instead of guessed;
- [ ] no planned edit targets WordPress core, Bricks parent theme, WooCommerce core or vendor.

## B. Bricks-native decision

PASS only if the solution ordering is respected:

```text
Bricks native element
-> Bricks dynamic data / Query Loop / conditions
-> WordPress/WooCommerce API
-> Custom Bricks Element only when native is insufficient
```

- [ ] native element exists/was considered for the active Bricks version;
- [ ] no parallel PHP/HTML layout duplicates an available Bricks element;
- [ ] custom element has a concrete native-gap justification.

## C. Real Bricks template

For Header/Footer/Archive/Single/Woo template work:

- [ ] implementation creates/updates a real Bricks template, not a fake PHP/Page replacement;
- [ ] current version contract for `BRICKS_DB_TEMPLATE_SLUG` is respected;
- [ ] `BRICKS_DB_TEMPLATE_TYPE` is correct;
- [ ] tree is stored in the correct Bricks content/header/footer context (`BRICKS_DB_PAGE_CONTENT`, `BRICKS_DB_HEADER`, `BRICKS_DB_FOOTER` as applicable);
- [ ] `BRICKS_DB_TEMPLATE_SETTINGS` contains the intended conditions/settings;
- [ ] conditions match the intended context and do not unintentionally overlap other templates;
- [ ] Woo template role is correct when applicable: `wc_archive`, `wc_cart`, `wc_cart_empty`, `wc_form_checkout`, `wc_thankyou`.

## D. Tree integrity

- [ ] every element has `id`, `name`, `parent`, `children`, `settings` in the current-version shape;
- [ ] new generated IDs are unique and six-character alphanumeric unless the installed version proves another native contract;
- [ ] no duplicate IDs;
- [ ] every non-root parent exists;
- [ ] every child ID exists;
- [ ] parent/children relations are reciprocal;
- [ ] sibling order is preserved unless intentionally changed;
- [ ] an ID remap updates element ID + parent children + child parents + only proven ID references;
- [ ] no global serialized ID replacement is used.

## E. Seed once / Builder truth

- [ ] first seed has a project-specific seed key/meta marker;
- [ ] second seed run is a no-op;
- [ ] existing intended template/page/menu is not overwritten;
- [ ] increasing a code/layout version does not rewrite the whole Builder tree;
- [ ] user-edited/deleted seeded menu/template content is not silently recreated;
- [ ] current Builder data remains source of truth.

## F. Targeted migration

- [ ] migration locates exact target via stable evidence;
- [ ] only target node/setting/condition changes;
- [ ] expected-old precondition exists for managed setting updates;
- [ ] user-changed Builder value is preserved;
- [ ] migration is idempotent;
- [ ] material/destructive DB change has an appropriate backup/recovery point;
- [ ] marker advances only after save + cache/CSS completion;
- [ ] unrelated siblings/settings/conditions are preserved.

Test compare-and-set example:

```text
imageSize medium_large -> large
current medium_large => changed
current large => no-op
current custom value => preserved/conflict
```

## G. Delete element

- [ ] exact target ID is located;
- [ ] deleted ID/subtree behavior is explicit;
- [ ] deleted ID is removed from parent `children`;
- [ ] no dangling child `parent` references remain;
- [ ] sibling order/settings remain unchanged;
- [ ] template was not reseeded merely to remove one node.

## H. Bricks CSS/cache

After Bricks DB changes:

- [ ] `clean_post_cache($post_id)` is part of completion;
- [ ] affected Bricks template/cache is refreshed when required;
- [ ] `\Bricks\Database::get_setting('cssLoading')` is checked;
- [ ] when CSS loading is `file`, `\Bricks\Assets_Files::generate_post_css_file(...)` is invoked using the installed-version signature;
- [ ] context is correct: `content`, `header`, or `footer`;
- [ ] migration is not marked complete if CSS generation fails;
- [ ] frontend output is checked for stale CSS.

## I. WordPress menu

- [ ] menu source is a real WordPress nav menu/location;
- [ ] seed uses WordPress menu APIs only once/explicitly;
- [ ] desktop and mobile resolve the same menu source;
- [ ] there is no duplicate independently maintained mobile menu;
- [ ] there is no duplicate hamburger when Bricks nav already handles it;
- [ ] user-edited/deleted seeded menu content is not auto-recreated.

## J. Archive

### WordPress archive

- [ ] real Bricks Archive template;
- [ ] dynamic archive title/description;
- [ ] native `posts` element/main-query consumption;
- [ ] archive-main-query setting such as `is_archive_main_query=true` is used when supported;
- [ ] no redundant manual category/term query when main query already supplies records.

### Product archive

- [ ] real `wc_archive` template;
- [ ] native archive title/description/product elements when supported;
- [ ] public product taxonomies are discovered;
- [ ] `product_type` and `product_visibility` are excluded from generic public taxonomy conditions;
- [ ] product archive uses intended main query rather than leaking custom filters globally.

## K. Single post

- [ ] `post-title` preferred;
- [ ] featured image uses native dynamic data/image;
- [ ] `post-content` uses WordPress content source when supported;
- [ ] `post-navigation` preferred;
- [ ] `related-posts` preferred;
- [ ] post body is not duplicated via PHP.

## L. WooCommerce native flow

PASS relevant flow checks:

- [ ] product archive uses native Woo/Bricks archive flow;
- [ ] single product preserves Woo variations/add-to-cart/business state;
- [ ] Cart prefers native cart items/coupon/collaterals;
- [ ] Empty Cart uses native Bricks Woo role when supported;
- [ ] Checkout prefers customer-details + order-review native elements;
- [ ] Thank You prefers `woocommerce-checkout-thankyou`;
- [ ] mini cart keeps Woo cart/session/fragments as source of truth;
- [ ] related/upsell/cross-sell uses Woo/native relations rather than hard-coded product IDs;
- [ ] no whole Woo template override is introduced for a small presentation change.

## M. Woo Blocks vs Bricks classic migration

- [ ] assigned Cart/Checkout page is resolved by `wc_get_page_id()`;
- [ ] current post content is inspected;
- [ ] migration runs only when relevant Woo block is actually present;
- [ ] verified Bricks setup actually requires classic shortcode content;
- [ ] original block content is backed up exactly;
- [ ] unrelated custom page content is not overwritten;
- [ ] migration has marker, is idempotent and reversible.

## N. Custom Bricks element

- [ ] extends `\Bricks\Element`;
- [ ] Builder controls exist;
- [ ] configurable settings have sane defaults;
- [ ] site-varying data remains editable/dynamic;
- [ ] render uses WP/Woo APIs;
- [ ] output is escaped and class-scoped;
- [ ] AJAX/mutations use nonce/capability/sanitization as required;
- [ ] JS avoids duplicate binding after Bricks rerender.

## O. Architecture/assets

- [ ] `functions.php` remains a thin loader/registration/enqueue layer;
- [ ] feature logic is modular (`inc/setup`, header/home/blog/shop/product/pages, `elements`, `assets/css`, `assets/js` or existing equivalent);
- [ ] CSS/JS is scoped by page/component;
- [ ] enqueue is conditional where practical;
- [ ] local assets may use `filemtime()` versioning appropriately;
- [ ] frontend-only assets do not break/run unnecessarily in Bricks Builder.

## P. Responsive

Check desktop, tablet, mobile:

- [ ] no horizontal overflow/hard width bug;
- [ ] banner/media not broken by unjustified fixed height;
- [ ] grid cards do not stretch into excessive blank space;
- [ ] image source/size is not unnecessarily blurred/upscaled;
- [ ] product cards stay inside viewport;
- [ ] no duplicate hamburger;
- [ ] mobile and desktop menu data are identical in source;
- [ ] scoped use of `minmax(0,1fr)`, `width:100%`, `max-width`, `aspect-ratio`, `object-fit`/media queries is appropriate.

## Q. Discovery/no hard-code

- [ ] no project/reference domain embedded in skill;
- [ ] no copied project prefix;
- [ ] no hard-coded post/template/attachment/term IDs in reusable skill logic;
- [ ] Woo pages resolve with Woo APIs;
- [ ] nav locations resolve with WordPress APIs;
- [ ] product taxonomies are discovered when possible;
- [ ] prefix is derived/reused from the current project.

## R. Reusable item layouts

For product/post cards and repeated collection items:

- [ ] existing item renderer/layout/component is searched before creating another implementation;
- [ ] product archive, taxonomy, related, featured, search, homepage and slider collections reuse the same normal product item layout when no special layout was explicitly requested;
- [ ] blog/archive, category/tag, related and search collections reuse the same normal post item layout when no special layout was explicitly requested;
- [ ] query/filter/wrapper differences are kept separate from item presentation;
- [ ] grid/list/slider wrapper changes do not duplicate the full item markup;
- [ ] small contextual differences use arguments, data, modifier classes or wrapper CSS instead of copy/pasted card markup;
- [ ] shared item CSS is owned by the component rather than duplicated across page stylesheets;
- [ ] no page-specific renderer is introduced merely because the same item appears in another section;
- [ ] a distinct item variant exists only when explicitly requested by the user or already intentionally defined by the project;
- [ ] when duplicate item implementations are consolidated, current frontend output and Builder edits are preserved.

## S. Frontend design system consistency

For frontend CSS/page/component work:

- [ ] the project's global stylesheet (`main.css`, `base.css`, `variables.css`, or equivalent) is identified before inventing reusable visual values;
- [ ] site-wide shell/max-width and desktop/mobile gutters come from one shared system for normal pages;
- [ ] normal page titles, section titles, card titles, body text, metadata/labels and content headings reuse the established typography scale;
- [ ] reusable colors, spacing, radii, control heights, shadows and transitions consume global tokens when equivalent tokens exist;
- [ ] component/page stylesheets primarily own structure and intentional component-specific behavior rather than redefining global primitives;
- [ ] a narrower text/content measure does not accidentally narrow the outer Bricks/site shell;
- [ ] page-specific literal values are used only when genuinely local or an intentional named variant;
- [ ] shared primitives such as shell, breadcrumb, page title, section title, buttons and inputs are not independently reimplemented across page stylesheets;
- [ ] no new `*-v2.css`, `refinements.css`, `fixes.css` or equivalent override layer is introduced merely to fight existing CSS when the owning rule can be corrected;
- [ ] proven obsolete override files are removed only after their live usages and enqueue order are mapped;
- [ ] WordPress/Bricks/Woo/plugin/vendor core CSS is not edited to impose the child theme design system;
- [ ] third-party frontend UI is adapted with documented controls or narrowly scoped child-theme CSS using site tokens where practical;
- [ ] intentional special hero/editorial/layout variants are preserved rather than blindly normalized;
- [ ] representative page families align visually at desktop/tablet/mobile after refactor.

## T. Syntax + focused behavior tests

Run only relevant checks:

```text
changed PHP -> php -l changed PHP files
changed JS -> node --check changed plain JS/CJS/MJS files when applicable
Bricks tree migration -> tree integrity + idempotency + user-edit preservation + CSS refresh
menu -> same source desktop/mobile
archive -> main query + negative/unrelated query check
Woo flow -> affected flow only
reusable item -> same renderer/layout across normal archive/related/featured/search contexts
design system -> compare shell edges, typography scale, spacing/radius/color tokens and override/enqueue ownership across representative pages
UI -> desktop/tablet/mobile
skill package -> contract/activation/resource routing tests
```

## Skill independence contract

The skill must remain fully operational if every reference/sample project is deleted.

Contract test fails if the skill instructs the agent to open another project for implementation knowledge, embeds another project's domain/path/prefix/IDs, or omits the real-template/tree/seed/migration/CSS/menu/Woo/archive/responsive/discovery/reusable-item/design-system contracts above.
