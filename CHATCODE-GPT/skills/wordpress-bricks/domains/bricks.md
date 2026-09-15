# Bricks Builder domain

Use for Bricks templates, Builder controls, editable sections, Query Loop/dynamic data, Global Queries, template conditions, components/variants/slots, reusable custom elements and persisted Bricks structure.

## Native-first procedure

1. Use native Bricks elements/controls/templates first.
2. Use dynamic data, Query Loop, Global Queries and conditions before custom PHP rendering when they express the requirement.
3. A normal section composed of container/grid/image/icon/text/button/slider/query elements is not a custom-element gap.
4. Create a custom Bricks element only when reusable data/behavior cannot be expressed cleanly with native Builder.
5. If a custom element is justified, ordinary content/options must be Builder-editable through controls; do not force future content edits back into PHP.
6. Preserve existing Builder IDs, parent/children/slotChildren, component links, variants, conditions and unrelated user-edited settings.
7. Reuse shared renderers/components before creating another implementation.

## Element ID contract — mandatory

- Bricks element IDs are generated and can change after clone/import/rebuild. Treat every element ID as **task-local evidence**, never as durable memory.
- Before using a Bricks ID in CSS, `#brxe-*`, query/filter target, JS selector, migration or persisted relation, read the **current persisted Bricks tree** for the target page/template in the same task.
- Chat history, previous tasks, frontend DOM/export, Anima-like exports and IDs from another project are not authoritative.
- Prefer semantic project-controlled classes/global classes over generated element-ID selectors whenever possible.
- New Bricks 2.3.13 element IDs should use the canonical six-character lowercase hex format; preserve existing IDs instead of rewriting them for style alone.

## Bricks 2.3.13 Spec Engine

- Exact JSON/value-shape knowledge comes from the source-verified 2.3.13 spec. Project/local evidence has priority.
- If detected version is not an exact verified spec, use only invariant facts until local source confirms the exact shape; never guess setting keys.
- Existing data is read-tolerant: Bricks can treat missing leaf `children` as `[]` and missing `settings` as empty. ChatCode-generated/replaced nodes should still be canonical.
- Component instances may use `cid`, `properties`, `variant`, `slotChildren` and runtime IDs (`instanceId`, `cssInstanceId`, `slotInstanceId`, `parentComponent`). Do not mistake render-time IDs for persisted node IDs.
- Setting suffixes may represent `variant-*`, configured breakpoint and pseudo selector. Project breakpoints/pseudo selectors override assumptions.
- `content` is the persisted normal Single template type in 2.3.13.

## Query & global data

- Global Query loops may store only `query.id` locally. Preserve `bricks_global_queries` references instead of flattening them into local query settings without request.
- Pagination can validly target `queryId=main`. Query/filter target validation is element-aware; component runtime targets can include an instance suffix.
- Existing Theme Styles, Style Manager, global variables/classes, global queries and components are ownership candidates before new CSS/PHP abstractions.

## Verification

- Builder can still edit expected ordinary content/settings.
- Template type/conditions and parent-child/slot structure remain valid.
- Existing reusable renderer/element/component is not duplicated.
- Query/filter targets resolve under the correct main/local/global/component semantics.
- Bricks JSON structural/spec validation passes when JSON content is touched.
- Persisted DB Builder mutation needs live DB-capable verification when available; otherwise report that structural DB verification could not run.
- CSS/cache regeneration runs only when the touched Bricks path requires it.
