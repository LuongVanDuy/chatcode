# UI design domain

Use for visual hierarchy, layout, spacing, responsive behavior, typography, color, components, forms, navigation and interaction quality.

## Procedure

1. Treat the current project design system as source of truth: reuse existing tokens, container rules, type scale, radius, button patterns and shared components before proposing new ones.
2. Use deterministic UI knowledge matches attached to the task only when they fit current project evidence.
3. Separate global problems from page/component problems: global tokens belong to the established global owner; local CSS stays scoped to its page/component CSS owner. Do not accumulate unrelated overrides in `style.css`.
4. Prefer semantic project-controlled classes/global classes. Avoid generated Bricks IDs, `#brxe-*`, `[data-field-id]` or exported preview selectors unless the current target was verified and the coupling is intentional.
5. Preserve content hierarchy and responsive reflow. Do not solve layout problems by stretching images, hiding important content or adding arbitrary fixed widths.
6. A polished change should reduce exceptions, not create another isolated visual language.
7. For a reference site, reproduce intended composition/asset relationships through the current Bricks/project architecture rather than copying exported preview markup.

## Verification

- Check desktop, tablet and mobile for every touched layout/responsive task.
- Compare the touched component with at least one adjacent/shared usage when relevant.
- Check focus/interaction states for touched controls.
- Confirm no new raw token/value is introduced when an equivalent project token already exists.
- A successful write/deploy is not visual proof. Claim frontend/live PASS only after the live rendered result was actually verified; otherwise state that live visual verification was unavailable.
