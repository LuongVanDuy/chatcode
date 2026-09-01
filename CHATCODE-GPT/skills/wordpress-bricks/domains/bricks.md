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

## Verification

- Builder can still edit expected ordinary content/settings.
- Template type/conditions and parent-child structure remain valid.
- Existing reusable renderer/element is not duplicated.
- CSS/cache regeneration is performed only when the touched Bricks path requires it.
