# Targeted Bricks migration strategy

Use this resource only when a task must **transform persisted Builder/WordPress/Woo state that already exists** and the transformation must be safe to re-run. Current Builder data is the source of truth.

## Migration threshold

A real migration normally has persisted state to upgrade, repeat-run/idempotency requirements, user edits to preserve, and meaningful rollout/rollback concerns.

These are **not migrations by default**:

- initial implementation of a new site/header/footer/page/section;
- first intended Bricks template during setup;
- ordinary PHP/CSS/JS refactor or rendering change;
- moving code between child-theme files;
- a small setup hook coupled to one feature;
- a source default change when no persisted managed record needs upgrading.

Decision:

```text
normal code/layout/setup edit -> existing functional owner -> no migration file
persisted data needs safe upgrade -> targeted idempotent migration logic
multiple independent/sequential upgrades -> dedicated migration module may be justified
```

Do **not** create `*-migration.php` merely because a task touches Bricks. A dedicated migration file needs a **proven independent migration lifecycle**. Avoid vague pairs such as `site-parts.php` + `site-parts-migration.php` for ordinary work.

## Durable migration state

Only when durable rollout state is needed, reuse a project-specific prefix, e.g.:

```text
<prefix>_bricks_seed_version
<prefix>_bricks_schema_version
<prefix>_bricks_migration_<name>
```

Never copy markers/prefixes from another project or add a marker for a normal code edit.

## Required properties

Every real migration must be:

- targeted and preconditioned;
- idempotent;
- Builder/user-edit preserving;
- relation-safe for Bricks parent/children;
- backed up when material/destructive;
- marked complete only after save + required CSS/cache refresh succeeds;
- observable as changed/no-op/skipped/conflict;
- reversible when replacing destructive source content.

## Target discovery

Use strongest current-project evidence in order: resolved post/template ID -> project-owned semantic/seed identity -> exact template type/conditions -> stable element ID -> scoped class/name + surrounding structure -> guarded unique settings match. Never mutate the first visually similar node.

## Compare-and-set

For a stored setting change such as `imageSize: medium_large -> large`:

- old expected value -> change;
- already-new value -> no-op;
- any other current value -> preserve Builder edit and return conflict.

Do not advance migration state on conflict or partial cache/CSS failure.

## Bricks element IDs and relations

When a persisted-tree migration creates an element, generate a **six-character alphanumeric** ID matching installed Bricks behavior unless current evidence proves otherwise. Build the current ID set, reject collisions, update reciprocal `parent`/`children`, preserve sibling order, then validate the whole tree.

For ID remap `A -> B`, prove A is target and B is unused; update only proven references: node `id`, parent `children`, direct child `parent`, and settings explicitly storing that relation. Never global-replace serialized content.

Validation: unique IDs; every parent/child exists; reciprocal relations match; sibling order and unrelated settings remain unchanged.

## Delete/insert persisted nodes

Delete only the exact target/subtree, remove dangling references, and reparent descendants only when explicitly intended. If descendant behavior is ambiguous and cannot be safely inferred, return conflict.

For insertion into an existing persisted tree: locate exact parent -> generate unique ID -> create node with parent -> insert ID at intended position -> preserve siblings -> validate -> persist -> refresh required CSS/cache.

Initial construction of a new page/template is setup/seeding, not automatically a migration.

## Template condition migration

Only for an already-persisted Header/Footer/Archive/Single/Woo template whose stored conditions need upgrading:

```text
read current type/settings/conditions
-> identify exact old condition
-> inspect overlaps
-> patch only intended condition
-> preserve unrelated Builder settings
-> validate positive/negative render contexts
-> persist + refresh relevant cache/CSS
```

Do not create a duplicate template to avoid fixing conditions. Add a durable marker only when rollout state really needs one.

## Seed evolution

A changed source default does not authorize reseeding. If existing managed data actually needs an upgrade, use sequential targeted schema changes such as v2 setting change, v3 obsolete node removal, v4 relation/condition repair. Each step independently verifies current Builder state. If no persisted record needs upgrade, keep the change in normal setup/source code.

## Bricks CSS/cache transaction

For a real Bricks DB mutation:

1. write validated tree/template settings;
2. call `clean_post_cache($post_id)`;
3. refresh affected Bricks cache/template state;
4. when CSS loading is file-based, call `\Bricks\Assets_Files::generate_post_css_file(...)` using the correct installed-version signature/context;
5. clear only relevant caches;
6. verify generated/frontend state;
7. only then advance a required migration marker.

If generation fails, report partial/failed rather than complete.

## Woo Blocks -> classic content migration

Only when verified Bricks/Woo behavior requires **classic shortcode** content and the assigned Woo page already has persisted block content that must be converted:

```text
resolve page with wc_get_page_id()
-> inspect post_content
-> prove relevant Woo block exists
-> detect unrelated custom content
-> backup exact original
-> convert only when safe
-> save + clean cache
-> store reversible backup/marker when required
```

Never overwrite unsafe mixed content. Second run must be no-op; rollback restores exact original content.

## Conflict and rollback

Prefer structured conflict over overwriting Builder edits. Record migration/target/reason plus expected old, current and proposed new values. Typical reasons: `builder_value_changed`, `target_missing`, `unsafe_mixed_content`, `duplicate_id`, `relation_invalid`.

Before material/destructive persisted changes, use work-session recovery or an exact project-specific backup. Rollback restores the exact pre-migration tree/content, then repeats `clean_post_cache($post_id)` and required Bricks CSS/cache regeneration.
