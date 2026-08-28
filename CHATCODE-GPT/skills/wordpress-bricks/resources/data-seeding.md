# Safe WordPress/Bricks data seeding and duplicate repair

Use this contract whenever code creates WordPress posts, pages, CPT records, nav items, Bricks templates, sample/demo data, assigned pages, or other persistent records automatically.

## Idempotent is not enough: seed creation must be concurrency-safe

A normal check-before-create flow is race-prone:

```text
get_option()/query existing
-> nothing found
-> wp_insert_post()
-> write role/meta/template settings
-> update_option(pointer)
```

Two requests can both pass the first check before either request writes the marker, creating duplicate rows. Do not treat a final `update_option()` marker as a lock.

Before any automatic create operation that may run from web requests, acquire a project-specific atomic lock using a storage primitive with a uniqueness guarantee. In WordPress, `add_option()` with a unique option name is the preferred simple lock when appropriate because only one concurrent request can create the option row.

Example contract:

```text
build project-specific lock key
-> atomically acquire lock
-> if lock unavailable: do not create; exit/retry safely
-> re-query current DB state while holding lock
-> adopt existing intended record if found
-> create only if still absent
-> write stable role/identity meta + Bricks type/conditions
-> verify saved state
-> update canonical pointer/seed marker
-> release lock
```

The second DB lookup under the lock is mandatory. The pre-lock lookup is only an optimization and is never sufficient proof that creation is safe.

Locks must be project-specific and operation-specific. Do not copy another project's option name. Include a bounded stale-lock/recovery strategy when a crash could leave a persistent lock behind; never allow a stale lock cleanup path to make two active creators run concurrently.

Prefer explicit install/setup/admin migration paths over repeatedly running seed creation on normal frontend requests. If a normal request can trigger the seed, the atomic lock is mandatory.

## Stable identity for generated records

Do not identify seeded records by title alone. Titles are editable and may collide.

Use the strongest combination available:

- project-owned stable role/semantic meta key;
- post type;
- Bricks template type;
- Bricks template conditions;
- taxonomy/post relationship where relevant;
- project-specific sample/data key;
- canonical option pointer only as a pointer, not the sole identity.

For a generated Bricks template, inspect role meta + template type + conditions before creating another one. For generated sample posts/CPT records, use a project-specific semantic key such as a sample key/role key and query all matching records before inserting.

## Duplicate detection and repair

If older code already created duplicates, repair them with a one-time targeted migration rather than silently creating more records.

Recommended repair flow:

```text
acquire repair lock
-> query all candidate rows from current DB
-> group by stable semantic identity
-> choose one canonical row deterministically
-> preserve canonical Builder/content data
-> move proven duplicates to Trash
-> repair option/pointer references to canonical IDs
-> verify expected active counts/types/conditions
-> save repair report
-> mark migration complete
-> release lock
```

Rules:

- Do not permanently delete duplicate posts/templates by default; use WordPress Trash when the post type supports it so recovery remains possible.
- Never trash a record merely because its title is similar. Prove duplicate identity using role/meta/type/condition/content evidence.
- Prefer the record already referenced by a valid canonical option/assignment when it is otherwise valid; otherwise choose deterministically using the strongest current-state evidence.
- Do not overwrite the retained record's Bricks Builder tree just to match a seed default.
- After cleanup, repair every project-owned option/pointer that referenced a discarded duplicate.
- Re-run detection after repair to prove only the intended active records remain.
- The repair migration must be idempotent; a second run is a no-op.

## Repair reports

For material duplicate cleanup, store or return an auditable project-specific report containing enough evidence to understand what happened, for example:

```text
before_count
canonical_ids
trashed_duplicate_ids
repaired_pointer_names/ids
after_count
status
```

Do not hard-code a generic report option key across projects. Derive a project-specific key.

## Bricks templates

When automatically creating Header/Footer/Archive/Single/Woo/custom-post-type Bricks templates:

- query existing Bricks templates first;
- match project role meta + template type + intended conditions;
- acquire the creation lock before insert;
- re-query under lock;
- adopt a valid existing template instead of creating another;
- write role meta/type/conditions before releasing the lock;
- only then update the project's canonical template option/pointer;
- never use title-only existence checks.

Do not create a second Archive/Single template merely because the option pointer is missing or stale. Repair/adopt the existing valid template and repair the pointer.

## Sample/demo/CPT data

For generated posts such as jobs, FAQs, testimonials, products, locations, or demo records:

- assign a stable project-specific semantic key per intended record;
- query by that key before insert;
- protect the entire check/create sequence with the atomic seed lock;
- re-query under the lock;
- create only missing semantic keys;
- do not treat count alone as identity;
- do not recreate a user-deleted/edited seed item unless the product requirement explicitly requires reconciliation.

## Workspace state is not live database evidence

Keep these states separate:

1. code/workspace state;
2. deployed filesystem state;
3. live WordPress database state;
4. live frontend state.

Reading source code can prove a race condition exists in the implementation, but it cannot prove the current live database row count. A frontend URL check can prove routing/output behavior, but it is not a substitute for a database query.

If the connector does not expose SQL, WP-CLI, PHP execution, or another verified live DB read path:

- say explicitly that exact live DB counts/rows were not verified;
- do not claim a cleanup migration has already run on live;
- report what is proven from source/workspace separately from what still requires live execution;
- do not invent template/post IDs, counts, migration report values, or option values.

When live DB access is available, inspect the actual rows/meta/options before and after repair and report the concrete evidence.

## Completion contract

A persistent-data seed/repair task is complete only when the relevant checks pass:

- creation path is concurrency-safe, not just idempotent;
- state is re-queried while holding the lock before insert;
- stable semantic identity is used instead of title-only matching;
- duplicate repair preserves one canonical record and uses Trash by default for proven duplicates;
- canonical options/pointers are repaired;
- migration/seed markers advance only after the whole operation succeeds;
- second run creates no additional records;
- live DB claims are backed by an actual live DB-capable tool or are clearly labeled unverified.
