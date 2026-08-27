# WordPress + Bricks validation

Run only the checks relevant to the files/feature changed. Do not rerun unrelated ChatCode installer/tunnel/updater suites for a skill-only change.

## Pre-change inspection

- [ ] Active child theme/custom plugin identified.
- [ ] No planned edits target WordPress core, Bricks parent theme, WooCommerce core or vendor.
- [ ] Affected Bricks page/template IDs and template type identified.
- [ ] Current element tree/settings/conditions read before mutation.
- [ ] Existing seed/migration markers inspected.
- [ ] Existing WordPress menu source identified for navigation work.
- [ ] Existing WooCommerce template/query flow identified for commerce work.
- [ ] Existing custom element/assets checked to avoid duplicates.

## Bricks-native decision

- [ ] Native Bricks element/control considered first.
- [ ] WordPress/WooCommerce API considered before custom rendering/state.
- [ ] Bricks dynamic data/query/conditions considered.
- [ ] Custom element justified only if native approach is insufficient.
- [ ] No parallel PHP/HTML UI duplicates a native Bricks feature.

## Seed/migration

- [ ] Existing Builder content is not reseeded.
- [ ] Seed routine is one-time/idempotent.
- [ ] Migration targets exact element/setting/condition.
- [ ] Migration has expected-old/precondition where applicable.
- [ ] User-modified Builder value is preserved on conflict.
- [ ] Marker/version advances only after success.
- [ ] Running migration twice is a no-op on second run.
- [ ] ID changes preserve reciprocal parent/children relations.
- [ ] Unrelated siblings/settings/conditions remain untouched.

## Bricks CSS/cache

When Bricks data affecting rendered style/class/settings changed:

- [ ] Current site CSS mode identified.
- [ ] Affected post cache cleaned.
- [ ] Bricks generated CSS regenerated if CSS-file mode requires it.
- [ ] Relevant page/object/plugin cache cleared only as needed.
- [ ] Frontend no longer serves stale generated CSS.

## Menu/header

- [ ] Desktop/mobile use the same WordPress menu source.
- [ ] No second mobile-only menu content tree created.
- [ ] No duplicate hamburger/toggle exists.
- [ ] Header/Footer template conditions do not overlap unintentionally.

## WooCommerce

For relevant tasks:

- [ ] Product archive query is scoped to intended loop/context.
- [ ] Single product variation/add-to-cart behavior remains native.
- [ ] Cart/session state remains WooCommerce-owned.
- [ ] Checkout fields/nonces/endpoints remain valid.
- [ ] Thank-you/order-received lifecycle remains WooCommerce-owned.
- [ ] Mini-cart/fragments behavior is not duplicated unnecessarily.
- [ ] Related products logic uses Woo/native scoped query.
- [ ] No whole Woo template override was introduced for a small change without justification.

## Custom element/AJAX

- [ ] Builder controls exist for configurable values.
- [ ] Output is escaped and scoped.
- [ ] Project data is not unnecessarily hard-coded.
- [ ] Query/API is WordPress/WooCommerce-native.
- [ ] AJAX nonce/capability/sanitization checks are present where required.
- [ ] JS does not double-bind after Bricks frontend/builder rerender.
- [ ] Assets load only where needed when practical.

## Syntax/behavior

Run only what applies:

```text
changed PHP -> php -l each changed PHP file
changed JS  -> node --check each changed plain JS/CJS/MJS file when applicable
changed CSS -> inspect syntax + target selectors + responsive behavior
Bricks data -> tree integrity + migration idempotency + CSS refresh verification
query change -> target query + negative/unrelated query check
menu change  -> desktop + mobile same source
Woo change   -> affected Woo flow only
```

## Responsive QA

For visual changes test at least:

```text
desktop: wide layout
 tablet: intermediate breakpoint
 mobile: narrow layout
```

Check:

- [ ] no horizontal overflow;
- [ ] no unintended fixed-width clipping;
- [ ] images are not unnecessarily blurred/upscaled;
- [ ] intentional crops use an explicit aspect ratio/object-fit;
- [ ] grids shrink using `minmax(0, 1fr)`/equivalent native controls;
- [ ] flex/grid children can shrink;
- [ ] menu toggle appears once;
- [ ] cards/content do not stretch to broken fixed heights.

## Skill independence contract

The installed skill package must contain all rules needed to execute this workflow without another project as a reference.

Contract test must fail if:

- the skill instructs the agent to open another project to learn implementation;
- the skill contains a copied project-specific prefix;
- seed-once, targeted migration, CSS regeneration, menu-source, WooCommerce, responsive or no-core-edit rules are missing;
- `prepare_task` cannot attach the skill for a Bricks task/project.
