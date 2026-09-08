# Bricks Builder domain

Use for Bricks pages/templates, Builder controls, editable sections, Query Loop/dynamic data and reusable Builder structure.

## Native-first

1. Use native Bricks elements/templates/controls first.
2. Normal container/grid/image/icon/text/button/slider/query layouts are not a custom-element gap.
3. Use dynamic data, Query Loop and conditions before custom PHP rendering when native Builder can express the requirement.
4. Create a custom Bricks Element only for proven reusable behavior/data that native Bricks cannot express cleanly.
5. Preserve existing Builder IDs, parent/children relations, conditions and unrelated user edits.
6. Reuse current renderers/components/owners before creating parallel implementations.

## Template identity

Before creating a Header/Footer/Archive/Single/reusable template:

```text
stable template ID/marker
→ same Bricks template type
→ same or overlapping conditions
→ normalized title fallback
```

Found means adopt/update; it does not mean create another copy. Seed/setup must become a no-op after success. Missing marker alone is never enough evidence to duplicate a template.

## Local ownership and naming

Keep project-local names short because the theme folder already supplies project identity.

Prefer `main.css`, `home.css`, `overview.css`, `init.php`, `home.php`, `.home-hero`, `.overview-intro`.

Do not repeat brand/site prefixes such as `mimosa-hotel-*` in ordinary local files/classes, and do not create per-section/helper/v2 files. Prefix only real global/collision boundaries such as PHP public symbols, handles, option/meta keys or custom element names.

## Bricks spec

- Runtime supplies compact version-aware shape knowledge when needed; do not duplicate or guess schema details.
- Project/local Bricks evidence outranks bundled baseline.
- If the installed version differs from verified spec, use invariant facts until local evidence confirms exact keys/shapes.
- Changed Bricks JSON must preserve tree integrity and supported shapes.

## Verify and stop

Verify only the touched Builder scope: editability, template identity/conditions, tree integrity and required responsive state. Regenerate CSS/cache only when the touched path requires it. Once scoped verification passes, stop; do not add another discovery/acceptance round.
