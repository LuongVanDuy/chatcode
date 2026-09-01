# Media and icon contract

Use this resource only when a WordPress + Bricks task imports/copies reference images, assigns media to repeated items, or adds functional/brand icons.

## Media: resolve slots, do not guess globally

Before importing or assigning reference media, build an explicit mapping for every intended slot:

```text
slot -> reference component/selector -> source URL -> attachment ID -> allow_reuse
```

Rules:

- A slot is a semantic position such as `brand:inax`, `category:bon-cau`, `hero:slide-2`, not merely an image filename.
- Default `allow_reuse = false`. Reuse is allowed only when the reference clearly uses the same asset or the user explicitly requests reuse.
- Resolve from the named reference component/DOM context first. Do not scrape the whole page, score unrelated images by keywords, then silently choose the highest score.
- Keep source URL/identity long enough to verify the import. Cache only a resolved mapping with enough identity to invalidate a wrong result; never let one bad cached attachment become permanent truth.
- If the exact slot cannot be resolved, return it as unresolved. Do not substitute the first image, a placeholder, or another slot's attachment and claim completion.

After import/assignment verify:

- every required slot resolved;
- distinct slots did not accidentally collapse to the same attachment;
- source URL/component matches the intended reference;
- dimensions/aspect ratio are plausible for the slot;
- attachment exists and is readable;
- alt text is appropriate when meaningful.

For repeaters/grids/sliders, check duplicate attachment IDs across items. Duplicate media is a failure unless `allow_reuse` is true for those slots.

## Bricks icon policy

Use the narrowest native representation:

1. Functional UI icon in editable Builder content -> Bricks Icon element or the installed Bricks icon control `{ library, icon }`.
2. Icon inside a repeater/custom element -> expose a Bricks icon control and render that control value.
3. Fixed functional icon in project code -> use a verified class from an icon library that the installed Bricks/site already loads; do not invent class names.
4. Brand marks, certifications, DMCA/Bộ Công Thương/Zalo/logo artwork -> use a real media/SVG asset with a stable asset owner.

Do not:

- concatenate `<i class="...">` into an ordinary text value merely to get an icon;
- hard-code one icon when the element is supposed to be Builder-editable;
- paste a large SVG/data URI into PHP for a reusable brand asset;
- fetch a random web SVG when Bricks already provides the required functional icon.

## Asset ownership

A downloaded/imported reference image belongs to WordPress Media Library or the established project asset owner. A project-owned static SVG belongs in a real asset file, not a long PHP string. Do not create an upload helper for each section: reuse one media service/helper, but require slot-level identity at each call site.

## Acceptance

PASS means the implementation can answer which reference asset belongs to each slot, duplicate IDs are intentional, and functional icons use Bricks/native verified icon infrastructure.

FAIL means several unrelated items share one attachment because of a fallback/default array, a whole-page keyword scorer selected ambiguous media, or PHP/text contains avoidable hard-coded icon markup/data URIs.
