# Frontend design system & visual consistency

These rules are mandatory for WordPress + Bricks frontend work. The site must behave like one visual system, not a collection of page-specific CSS experiments.

## Global source of truth

Use the project's global stylesheet (`assets/css/main.css`, `base.css`, `variables.css`, or the existing equivalent) as the source of truth for reusable visual values.

Global tokens should cover the categories the project actually needs, including:

- content shell/max width and horizontal gutters;
- reading/single/media widths when intentionally different;
- body, meta, label, card-title, page-title, section-title and content heading scales;
- body/heading/muted/border/surface/brand/accent colors;
- spacing scale and section/grid gaps;
- border-radius scale and pill radius;
- control/input/button heights;
- shadows;
- transitions/durations/easing;
- other truly site-wide primitives.

Do not require one exact token naming scheme. Reuse the current project's prefix and conventions.

Example shape only:

```css
:root {
  --site-shell: 1380px;
  --site-gutter: 24px;
  --site-gutter-mobile: 16px;

  --site-font-base: 16px;
  --site-font-card-title: 20px;
  --site-font-page-title: clamp(40px, 5vw, 60px);
  --site-font-section-title: clamp(30px, 4vw, 42px);

  --site-space-1: 4px;
  --site-space-2: 8px;
  --site-space-3: 12px;

  --site-radius-sm: 8px;
  --site-radius-md: 12px;
  --site-radius-lg: 16px;
}
```

The values above are examples, not defaults to copy into another project.

## One shell system across the site

Pages that belong to the normal site shell must align to the same left/right edges.

Do not let each module invent its own `max-width`, `padding-inline`, or `clamp()` gutter.

Preferred pattern is to reuse the site's shell token/class, for example:

```css
.site-shell {
  width: min(100%, var(--site-shell));
  max-width: var(--site-shell);
  margin-inline: auto;
  padding-inline: var(--site-gutter);
}
```

with the established mobile gutter token at the project breakpoint.

A narrower text column is valid only for the text/content inside the shell. Do not put an arbitrary narrow `max-width` on the outer Bricks container when the page is expected to align with Header, Footer and neighboring pages.

If a page intentionally needs a special shell, that is a design variant and must be explicitly justified by the task/project rather than invented locally.

## Component CSS consumes tokens

Page/component stylesheets should mainly define structure and component-specific behavior. Reusable visual constants must come from global tokens.

Examples:

```css
.recruitment-title {
  font-size: var(--site-font-page-title);
  color: var(--site-color-heading);
}

.product-card {
  border-radius: var(--site-radius-lg);
  gap: var(--site-space-4);
}
```

Do not create new literal font sizes, colors, shell widths, radii, standard gaps, control heights or shadows in a page stylesheet when an equivalent global token already exists.

A literal value is acceptable when it is genuinely component-specific and not a reusable design primitive, such as an icon offset, a one-off media aspect ratio, or a measured interaction geometry.

## Typography consistency

Use a deliberate site-wide type scale.

Normal equivalents should share tokens:

- page H1/title across normal pages;
- section headings across modules;
- card titles across card families unless the design defines a variant;
- body copy;
- metadata/labels;
- content H2/H3/H4/H5/H6 where the project has a content typography system.

Do not create visually equivalent headings with unrelated values such as `58px`, `62px`, `66px` just because they live in different page files.

Special hero/editorial typography is allowed only when it is an intentional named variant or explicitly requested.

## Shared common UI

When the same visual primitive appears across pages, prefer a common class/token in the global layer instead of duplicating it in every page stylesheet.

Typical shared primitives include:

- shell/container;
- breadcrumb;
- page title;
- section title;
- eyebrow/label;
- card surface/border/shadow;
- button;
- input/select/textarea;
- common content typography.

Do not force every component to use one universal card markup; reusable product/post item rules still apply separately. This rule governs shared visual primitives and tokens.

## Avoid override chains

Do not solve frontend drift by stacking more CSS override files such as `*-v2.css`, `refinements.css`, `fixes.css`, or a second stylesheet that only exists to override the first one.

When safe and within task scope:

1. identify the true owner of the rule;
2. move common tokens/primitives to the global layer;
3. keep component-specific rules in the component stylesheet;
4. remove obsolete duplicate/override declarations;
5. update enqueue order atomically;
6. verify no page still depends on the removed file.

Do not delete a legacy stylesheet merely for cleanliness if its live behavior has not been fully mapped.

## Dependency boundaries

Do not edit WordPress core, Bricks parent/core CSS, WooCommerce/plugin/vendor CSS to impose the site's design system.

For third-party/plugin UI shown on the frontend:

- prefer documented plugin controls/hooks first;
- otherwise style it from the child theme with a narrow site/component scope;
- consume the site's design tokens where practical;
- do not globally overwrite unrelated plugin/admin/Builder UI.

## Refactoring existing frontend CSS

When asked to normalize an existing site:

1. inventory frontend stylesheets and enqueue order;
2. find repeated literal values for shell/gutters/type/colors/spacing/radii/controls/shadows/transitions;
3. identify the current dominant/intentional site convention from existing polished pages/components;
4. define/reuse global tokens in the global stylesheet;
5. convert page/component CSS to consume those tokens;
6. consolidate duplicate common primitives into the global layer;
7. remove proven obsolete override layers only after usages are accounted for;
8. preserve intentional special variants;
9. verify desktop/tablet/mobile and key page families for visual alignment.

Do not normalize blindly by replacing every number with a variable. Preserve genuinely local geometry and intentional design differences.

## Acceptance examples

PASS:

```text
main.css
  -> global shell/gutters/type/colors/spacing/radius/control/shadow/transition tokens
  -> common shell/breadcrumb/title/button/input primitives

blog.css
  -> blog layout and blog-specific rules using global tokens

recruitment.css
  -> recruitment layout using the same shell/title/body/card primitives

partners-page.css
  -> partners structure using the same global system
```

FAIL:

```text
blog.css        -> page title 58px, shell 1360px, gutter 28px
recruitment.css -> page title 62px, shell 1380px, gutter clamp(...64px)
partners.css    -> page title 66px, outer container max-width 940px
fixes.css       -> overrides all three again
```

The goal is consistent ownership: **global design decisions live in the global design system; component files describe component structure and intentional variants.**
