# WordPress + Bricks chat review

## Scope

Review based on 88 turns across the three supplied ChatGPT conversations:

- BonCauINAX: WordPress, Bricks, and WooCommerce.
- EU Pharma: WordPress and Bricks.
- Mixed Long Khai/EU Pharma conversation: the Flatsome portion is excluded from Bricks implementation guidance, but retained as evidence that theme and project conventions must never leak across projects.

## Repeated failure patterns

1. A targeted request expanded into a redesign or file reorganization, including changing an agreed column layout into full-width sections.
2. Work rendered inside Bricks but was implemented as fixed PHP/HTML or shortcode wrappers, leaving normal content unavailable in Builder controls.
3. Bricks controls, template APIs, IDs, assets, and live state were guessed instead of inspected.
4. CSS ownership drifted into small per-section files, vague buckets, repeated overrides, and inconsistent typography/width tokens.
5. Seeds and repairs used non-atomic check-then-create flows, producing duplicate posts, products, or templates.
6. Tasks were reported complete without PHP syntax checks, reliable frontend/DB evidence, or an exact statement of what could not be verified.
7. Corrections had to be taught again in later chats because durable decisions were not stored per project.
8. The two-call MCP path duplicated Brain/Git work internally and attached WooCommerce guidance to non-Woo product CPT tasks.

## Implemented response

- Skill v3 locks scope, isolates Bricks from Flatsome conventions, preserves agreed Builder structure, requires real Builder controls for editor-owned content, and forbids speculative expansion.
- Resource routing now uses detected project capabilities. Generic product language activates Woo rules only when WooCommerce is detected; an explicit non-Woo CPT never receives Woo rules.
- `prepare_task` returns saved `project_rules`, a compact Git baseline, and one ranked inspection packet. It no longer duplicates the full baseline diff or Project Brain summary.
- `complete_task` can persist explicitly confirmed rules through `remember_project_rules` without adding an MCP tool. Memory is per project, capped, and rejects secrets, credential fields, and URLs.
- Completion infers PHP/JavaScript syntax checks when explicit commands are omitted. The Windows Safe runner can discover PHP in common Laragon/XAMPP layouts, including from a project under `laragon/www`.
- Finalization reuses the Brain/Git refresh already produced by patch application instead of rebuilding both again.

## Context measurements

Measurements use the same inspected non-Woo Bricks fixture before and after the change.

| Request | Before | After | Reduction |
|---|---:|---:|---:|
| Change site font to Montserrat | 18,236 chars | 15,803 chars | 13.3% |
| Create a product catalog CPT, explicitly no WooCommerce or price | 28,759 chars | 15,919 chars | 44.6% |
| Reuse a product card for a product CPT | 36,063 chars | 23,223 chars | 35.6% |

The non-Woo catalog request previously loaded `woocommerce.md` and `templates.md`. It now loads only the core and data-seeding rules. A real WooCommerce project still receives Woo and template rules for the same generic product wording.

## Operational boundary

Project memory only improves future tasks after a successful `complete_task` sends rules that the user explicitly confirmed. It does not import hidden ChatGPT memory or infer preferences from silence. Live Builder, database, and responsive visual claims still require the corresponding connected capability.

An already cached legacy ChatGPT connector may continue to expose only the older tool schema. Restart/reconnect ChatCode after installing this source build so the connector can discover the current `prepare_task` and `complete_task` schemas.
