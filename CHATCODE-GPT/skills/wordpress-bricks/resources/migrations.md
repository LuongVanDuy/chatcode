# Targeted Bricks migration strategy

Use this for any post-seed change to Bricks page/template data.

## Migration state

Each project chooses its own prefix. Keep separate markers for seed and later schema migrations, for example:

```text
<prefix>_bricks_seed_version
<prefix>_bricks_schema_version
```

Do not copy option names from another site. Prefer an existing project prefix when one already exists.

## Required migration properties

A migration must be:

- targeted: touches only intended element/settings/relations;
- preconditioned: verifies the expected old managed state;
- idempotent: second run performs no additional mutation;
- Builder-preserving: unrelated user edits survive;
- atomic enough that reciprocal element relations never remain half-updated;
- versioned: marker is written only after successful mutation and required CSS/cache work;
- observable: result records changed/skipped/conflicted targets.

## Locate the target safely

Use strongest evidence first:

1. known current post/template ID from project state;
2. project-owned seed metadata/semantic key;
3. current Bricks template type + conditions;
4. unique element ID confirmed to belong to the target tree;
5. element `name` + stable surrounding structure/settings as a guarded fallback.

Never mutate the first element whose label or CSS class merely looks similar.

## Compare-and-set update

Pseudocode:

```php
$current = read_current_bricks_tree( $post_id );
$element = find_exact_target( $current, $target );

if ( ! $element ) {
    return conflict('target_missing');
}

if ( current_value($element, $key) === $new_value ) {
    mark_migration_complete_if_safe();
    return no_op('already_migrated');
}

if ( current_value($element, $key) !== $managed_old_value ) {
    return conflict('builder_value_changed');
}

$next = patch_one_setting( $current, $element['id'], $key, $new_value );
validate_tree( $next );
write_bricks_tree( $post_id, $next );
refresh_bricks_css_and_cache( $post_id );
mark_migration_complete();
```

The actual read/write/CSS functions must be verified against the installed Bricks version/project helper before use.

## ID migration

Changing an element ID is higher risk than changing a setting. Build an explicit reference plan first.

For old ID `A` -> new ID `B`, inspect and update only proven references such as:

- target element `id`;
- its parent's ordered `children` entry;
- direct child `parent` values;
- settings that explicitly store this element ID;
- project-owned maps/selectors known to reference this ID.

Then validate:

- no duplicate IDs;
- every non-root parent exists;
- every listed child exists;
- reciprocal parent/child relationships agree;
- sibling order is preserved;
- unrelated IDs/settings are byte/logically unchanged where possible.

Do not global string-replace `A` with `B` through the serialized document or database.

## Template condition migration

For Header/Footer/Archive/Single/Woo templates:

1. inspect current template type and all conditions;
2. prove which condition is wrong/missing;
3. patch only that condition set;
4. detect overlapping templates before saving;
5. preserve unrelated conditions/user priority choices;
6. validate the intended frontend context and a context where it must not render.

Do not create a replacement template to avoid understanding the current conditions.

## Seed evolution

When code defaults evolve after a page/template was originally seeded, do not update the seed tree and rerun it.

Instead add a migration step:

```text
schema v1: initial seed
schema v2: update managed primary-nav setting when still at v1 value
schema v3: repair one managed element relation when old relation still exists
```

The migration registry can be sequential, but each step independently verifies current state.

## Conflicts

A conflict is safer than overwriting Builder edits.

Return a structured result such as:

```text
status: conflicted
migration: schema_v3
post_id: ...
element: primary_nav
reason: builder_value_changed
expected_old: ...
current: ...
proposed_new: ...
```

Do not silently coerce the current value. Ask for a decision only when the task truly requires overriding the Builder edit.

## CSS/cache transaction boundary

For migrations that affect rendered classes/styles/settings, the marker must not be considered complete until:

1. Bricks data write succeeds;
2. affected post cache is cleaned;
3. generated Bricks CSS is refreshed when required by current CSS mode;
4. relevant cache is cleared;
5. frontend verification confirms no stale generated output.

If CSS regeneration fails, return a partial/failure state and do not pretend the migration is complete.

## Rollback

Before a non-trivial Bricks-data migration, retain the current target post/template data using the project's existing recovery/work-session mechanism. Rollback restores the exact pre-migration data, then repeats post-cache/CSS regeneration so frontend state matches the restored Builder data.
