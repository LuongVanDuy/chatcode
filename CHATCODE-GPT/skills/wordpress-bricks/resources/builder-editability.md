# Builder-editable Bricks elements

Use this resource when creating or refactoring custom Bricks elements, replacing Shortcode elements, building configurable homepage/page sections, or migrating existing section data into Builder-owned settings.

The goal is not merely to make PHP render inside Bricks. The goal is that a site editor can open Bricks Builder and change the reasonable content/data choices without editing PHP, shortcodes, IDs, or hard-coded arrays.

## Native first, custom element second, shortcode wrapper last

Choose in this order:

1. Native Bricks elements/controls/dynamic data when they can express the section cleanly.
2. A real custom `\Bricks\Element` when reusable dynamic behavior needs code.
3. A Shortcode element only when the shortcode itself is the actual user-facing integration contract or a proven compatibility requirement.

Do not use a Shortcode element merely as a fast wrapper around project-owned section markup that should be editable as a Bricks element.

## Editable-data contract

For a custom Bricks element, inspect every value used by `render()` and classify it:

- **editor-owned**: content, selected records, selected terms, labels, images, links, button text, ordering, limits, presentation choices that the site editor may reasonably change;
- **derived/runtime**: IDs resolved from selected values, query results, Woo objects, nonce values, computed state;
- **implementation constant**: internal action names, semantic keys, CSS class structure, capability/security rules.

Editor-owned values must come from Builder controls, dynamic data, or an existing shared project setting. Do not hard-code them in the render class.

A custom element is incomplete if changing its ordinary content still requires editing PHP.

## Match the control to the data

Prefer the control that represents the actual domain instead of a generic text field.

Typical mapping:

```text
short label/title          -> text
long formatted content     -> editor / rich text
image                      -> image/media control
URL/CTA destination        -> link control
boolean                    -> checkbox/toggle
one mode/source            -> select
multiple records           -> query-aware post/product multi-select when supported
one/multiple taxonomy term -> taxonomy-aware select/multi-select when supported
repeatable tabs/items      -> repeater
number/limit               -> number
```

Verify the installed Bricks version's exact control types/options before implementation. Do not invent unsupported control names from memory.

## Product selection pattern

For a featured-products element, do not bake one fixed product set into code.

Recommended Builder contract:

```text
Source: Automatic | Manual

Automatic:
  -> resolve the project's intended automatic rule
     (for example featured products, category, query rule)

Manual:
  -> editor selects one or more products
  -> preserve explicit Builder ordering when supported
```

Render both modes through the project's shared product-item renderer/layout. The element chooses the data source; it does not create another product card implementation.

If the current section already has products, migration should populate the initial manual/default control values when that faithfully preserves current output.

## Product group / taxonomy pattern

For a product-group tabs element, taxonomy and terms are editor choices unless the user explicitly requests a fixed business rule.

Recommended contract:

```text
Taxonomy/source
  -> choose among valid public product taxonomies / project-defined group taxonomies

Terms
  -> select one or more terms from the chosen taxonomy
  -> preserve Builder ordering when possible
```

Do not hard-code taxonomy slugs or term IDs when they are discoverable from the project.

AJAX/REST requests must validate the requested taxonomy/term against the allowed configuration and must reuse the shared product renderer.

## Repeatable content pattern

Tabs, accordions, feature rows, team items, FAQ-like content, and other repeatable editor-owned content should normally use a repeater when a custom element is justified.

Example conceptual tab item:

```text
Tab title
Content title
Rich content
Image
Button label
Button link
```

The editor must be able to add/remove/reorder items in Builder when that matches the feature's purpose.

Do not store the initial tab content as a PHP array that Builder cannot edit.

## Defaults are not hidden source of truth

Defaults are allowed to make a newly inserted element useful, but once an element exists its Builder settings are source of truth.

Do not use code defaults to repeatedly recreate removed tabs, selected products, selected terms, images, or text after the user changes them.

When controls are absent on an older instance, a compatibility fallback may render the previous managed value during migration, but remove or retire the fallback once the migration safely owns the current Builder settings.

## Shortcode-to-element migration

When replacing a project-owned Shortcode element with a custom Bricks element:

1. Identify only the exact managed node(s).
2. Preserve element ID, parent, sibling order, and unrelated settings when possible.
3. Change the node type/name to the real custom element using the installed Bricks data contract.
4. Map the section's **current live/managed data** into the new element settings/controls.
5. Use compare-and-set semantics: if the Builder node no longer matches the expected old managed state, preserve the user's edit and skip/conflict instead of overwriting it.
6. Refresh Bricks generated CSS/cache when required.
7. Mark migration complete only after the migrated element can render and its controls contain the expected editable data.

Do not report a shortcode migration as complete merely because Structure shows a custom element name. The content/configuration must also be editable in Builder.

## Builder-preview behavior

Custom elements should provide a useful Builder preview where practical.

- Avoid frontend-only scripts that break Builder interactions.
- Use the installed Bricks editor/render context correctly.
- If AJAX is unnecessary for preview, prefer a server-rendered preview using current control values.
- Empty selections should show a useful Builder-only placeholder or clean empty state rather than PHP warnings.

## Acceptance checks

Before reporting a custom section complete, verify the controls that matter to the task, not just frontend HTML.

For configurable sections, ask:

- Can the editor change the selected products without touching PHP?
- Can the editor choose the intended taxonomy/terms?
- Can repeatable tabs/items be edited and reordered?
- Can images and links be replaced through Builder controls?
- Does render consume `$this->settings`/dynamic data rather than the old hard-coded dataset?
- Does migration preserve current visible content in the initial control values?
- Does the element still reuse shared product/post/item renderers?
- Were existing user Builder edits preserved?

PASS:

```text
Bricks custom element
-> Builder controls/repeater
-> selected products/terms/content/media/link
-> resolver/query
-> shared item renderer
-> scoped section behavior
```

FAIL:

```text
Bricks custom element
-> render() contains fixed product IDs / term IDs / tab content arrays
-> editor must edit PHP to change normal section content
```

A real Bricks element is not only an element class. It is a **Builder-editable contract** between the section and the site editor.
