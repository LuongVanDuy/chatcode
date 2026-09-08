# Bricks Builder domain

Use for Bricks templates, Builder controls, editable sections, Query Loop/dynamic data, template conditions, reusable custom elements and persisted Bricks structure.

## Native-first procedure

1. Use native Bricks elements/controls/templates first.
2. Use dynamic data, Query Loop and conditions before custom PHP rendering when they fully express the requirement.
3. A normal section composed of container/grid/image/icon/text/button/slider/query elements is not a custom-element gap.
4. Create a custom Bricks element only when the requirement has reusable data/behavior that native Builder cannot express cleanly.
5. If a custom element is justified, ordinary content/options must be Builder-editable through controls; do not force future content edits back into PHP.
6. Preserve existing Builder IDs, parent/children relationships, conditions and unrelated user-edited settings.
7. Reuse shared renderers/components before creating another implementation.

## Bricks Spec Engine

- Exact JSON/value-shape knowledge is attached by runtime from a compact version-aware spec, not duplicated in this document.
- Project/local Bricks evidence has priority over the bundled baseline.
- If the detected Bricks version does not match the verified baseline, use only invariant facts until local source confirms the exact shape; do not guess setting keys.
- Generated/changed Bricks JSON must satisfy deterministic tree integrity and supported shape checks before completion.
- Existing project Theme Styles, global variables/classes and native components are ownership candidates before new CSS/PHP abstractions.

## Verification

- Builder can still edit expected ordinary content/settings.
- Template type/conditions and parent-child structure remain valid.
- Existing reusable renderer/element is not duplicated.
- Query/filter targets point to real loop element IDs when relevant.
- Bricks JSON structural/spec validation passes when JSON content is touched.
- CSS/cache regeneration is performed only when the touched Bricks path requires it.
