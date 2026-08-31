# Targeted Bricks migration strategy

Use this resource only when the task must **transform persisted Builder/WordPress/Woo content that already exists** and the transformation must be safe to re-run across deployments or repeated requests. Builder-owned current data remains the source of truth.

## Migration threshold

A migration is justified when all/most of these are true:

- persisted Builder tree/template/menu/post/content/options already exist;
- current stored state must be changed to a new schema/shape/value;
- the change may run again and therefore needs idempotency/preconditions;
- user/Builder edits outside the managed target must survive;
- rollout state/marker/rollback matters across deployments or repeated executions.

These are **not migrations by default**:

- initial implementation of a new site/header/footer/page/section;
- creating the first intended Bricks template during initial setup;
- ordinary PHP/CSS/JS refactor;
- changing rendering code without transforming stored Builder/DB data;
- moving code between existing child-theme files;
- adding a small setup hook tightly coupled to a feature;
- changing a source default before any persisted managed record needs upgrading.

Decision rule:

```text
normal code/layout/setup edit
-> update the existing functional owner
-> no migration file

existing persisted data must be transformed safely
-> targeted migration logic
-> keep it in the existing owner/setup module when small and tightly coupled

multiple independent/sequential persisted-data upgrades
-> only then consider a dedicated migration module
```

Do **not** create `*-migration.php` merely because a task touches Bricks, a template, or setup code. A dedicated migration file needs a proven independent migration lifecycle. Avoid vague pairs such as `site-parts.php` + `site-parts-migration.php` for ordinary feature work.

## Migration state

When a real migration needs durable state, choose/reuse a project-specific prefix and keep seed/schema markers separate, for example:

```text
<prefix>_bricks_seed_version
<prefix>_bricks_schema_version
<prefix>_bricks_migration_<name>
```

Never copy marker names or prefixes from another project. Do not introduce a marker for a normal code edit that requires no persisted-data upgrade.

## Required properties

Every real migration must be:

- targeted: only the intended node/setting/condition/content changes;
- preconditioned: expected old state is verified before mutation;
- idempotent: rerun causes no further change;
- Builder-preserving: unrelated user edits survive;
- relation-safe: parent/children remain reciprocal;
- backed up when the DB/content change is material or destructive;
- versioned/marked only after the entire save + CSS/cache operation succeeds;
- observable: changed/no-op/skipped/conflict is explicit;
- reversible when migrating Woo page block content or another destructive source value.

## Target discovery order

Use the strongest current-project evidence:

1. current known post/template ID resolved from WordPress/Bricks/Woo state;
2. project-owned seed metadata/semantic key;
3. exact current Bricks template type + conditions;
4. stable element ID known to belong to that tree;
5. project-scoped class plus expected element `name` and surrounding structure;
6. guarded `name`/settings match only if unique and proven.

Do not modify the first visually similar element.

## Compare-and-set setting migration

Example intent:

```text
imageSize: medium_large -> large
```

Allowed outcomes:

- current `medium_large` -> change to `large`;
- current `large` -> already applied, no-op;
- any other value -> preserve Builder edit and return skipped/conflict.

Pseudocode:

```php
$current = read_current_bricks_tree($post_id);
$target  = find_exact_target($current, $target_spec);

if (!$target) {
    return conflict('target_missing');
}

$value = current_setting($target, 'imageSize');

if ($value === 'large') {
    return no_op('already_applied');
}

if ($value !== 'medium_large') {
    return conflict('builder_value_changed');
}

$next = patch_one_setting($current, $target['id'], 'imageSize', 'large');
validate_tree($next);
backup_if_material($post_id, $current);
write_bricks_tree($post_id, $next);
refresh_bricks_css_and_cache($post_id, $context);
mark_migration_complete();
```

Do not advance the marker on conflict or partial CSS/cache failure.

## Six-character ID generation

When a real persisted-tree migration creates a new Bricks element, generate a six-character alphanumeric ID matching native Bricks shape unless the installed version proves otherwise.

Algorithm contract:

```text
build set of every current element id
-> generate six-character alphanumeric candidate
-> reject if already present
-> repeat until unique
-> insert tree node
-> update reciprocal parent/children
-> validate whole tree
```

Never change an existing stable ID merely for aesthetics.

## ID remap

Changing element ID `A` -> `B` is high-risk and must be atomic.

Before mutation:

- prove `A` is the intended target;
- prove `B` does not exist;
- inventory direct structural references and any explicit settings/selectors that truly store the element ID.

Update only proven references:

- target `id`;
- parent's ordered `children` entry `A` -> `B`;
- direct children's `parent` value `A` -> `B`;
- settings/relations explicitly storing `A` as an element relation.

Then validate:

- all IDs unique;
- each non-root parent exists;
- each listed child exists;
- child.parent matches parent.children;
- sibling order preserved;
- unrelated elements/settings unchanged.

Never do global serialized string replacement.

## Delete element migration

Do not reseed the template to delete one existing persisted node.

Deletion contract:

```text
load current tree
-> locate exact element
-> collect removed id(s)
-> decide subtree behavior explicitly
-> backup current tree if material
-> remove only target/subtree
-> remove removed id(s) from parent.children
-> reparent children only when explicitly intended
-> validate no dangling parent/children refs
-> save
-> clean post cache
-> regenerate CSS/cache as required
-> mark migration when durable rollout state is actually needed
```

Do not modify unrelated sibling settings/order.

If deleting a parent with children and the task does not state whether descendants should be deleted/reparented, inspect existing structure and choose the least-destructive behavior only when clearly inferable; otherwise return conflict rather than corrupt the tree.

## Insert element migration

For insertion into an already persisted tree that truly requires migration behavior:

1. locate exact parent;
2. generate unique six-character ID;
3. create element with `parent=<parent-id>`;
4. insert new ID into parent's `children` at the intended position;
5. do not reorder existing siblings unless required;
6. validate tree;
7. persist and regenerate CSS/cache.

Initial construction of a new page/template is setup/seeding, not automatically a migration.

## Template condition migration

For an already persisted Header/Footer/Archive/Single/Woo template whose stored conditions must be upgraded:

```text
read current template type/settings/conditions
-> identify exact incorrect/missing condition
-> inspect overlapping templates
-> patch only intended condition data
-> preserve unrelated conditions and Builder settings
-> validate positive and negative render contexts
-> persist + cache/CSS refresh if relevant
-> mark migration only when durable rollout state is required
```

Do not create a duplicate template to avoid fixing conditions.

## Seed evolution

A changed default in source code does not authorize a reseed. If existing persisted managed data actually needs upgrading, use sequential targeted schema migrations:

```text
v1: initial seed
v2: change one managed setting if still at v1 value
v3: remove one obsolete managed element if still present in expected form
v4: repair one relation/condition if still at old managed state
```

Each migration verifies current Builder state independently. If there is no existing persisted record to upgrade, keep the change in normal setup/source code instead.

## Bricks CSS/cache transaction

For a real Bricks DB mutation:

1. write validated current tree/template settings;
2. call `clean_post_cache($post_id)`;
3. refresh affected Bricks template/cache if required;
4. if `\Bricks\Database::get_setting('cssLoading') === 'file'`, call `\Bricks\Assets_Files::generate_post_css_file(...)` using the correct `content`, `header`, or `footer` context and installed-version signature;
5. clear only relevant page/object/plugin cache when needed;
6. verify frontend generated output is current;
7. only then write/advance migration marker when such a marker is actually required.

If CSS generation fails, migration status is partial/failed; do not report complete.

## Woo Blocks -> classic content migration

Only run if the verified project/Bricks version requires classic shortcode content for the Bricks Cart/Checkout template path and the assigned Woo page already contains persisted block content that must be converted.

```text
resolve assigned Woo page with wc_get_page_id()
-> inspect current post_content
-> prove relevant Woo block exists
-> detect unrelated custom content
-> backup exact original content
-> if safe block-only conversion, replace with required classic shortcode
-> save + clean cache
-> store reversible backup + migration marker
```

If unrelated custom content cannot be safely retained, do not overwrite it.

Second run must be a no-op. Rollback restores the exact backed-up original content.

## Conflict result

Prefer a structured conflict over overwriting Builder edits:

```text
status: conflicted
migration: <project-specific-key>
post_id: <resolved id>
element: <semantic target>
reason: builder_value_changed | target_missing | unsafe_mixed_content | duplicate_id | relation_invalid
expected_old: ...
current: ...
proposed_new: ...
```

## Rollback

Before material/destructive persisted Bricks DB changes, use the project's work-session/recovery mechanism or an exact project-specific backup record.

Rollback must restore the exact pre-migration tree/content and then repeat `clean_post_cache()` plus Bricks CSS/cache regeneration so frontend state matches restored Builder data.
