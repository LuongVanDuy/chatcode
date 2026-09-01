# UI design domain

Use for visual hierarchy, layout, spacing, responsive behavior, typography, color, components, forms, navigation and interaction quality.

## Procedure

1. Treat the current project design system as source of truth: reuse existing tokens, container rules, type scale, radius, button patterns and shared components before proposing new ones.
2. Use the deterministic UI knowledge matches attached to the task. Apply only the matches that fit the current component and project evidence.
3. Separate global problems from page/component problems: global tokens belong to the established global owner; local CSS stays scoped to its component/page owner.
4. Preserve content hierarchy and responsive reflow. Do not solve layout problems by stretching images, hiding important content or adding arbitrary fixed widths.
5. Prefer consistency over novelty: a polished change should reduce exceptions, not create another isolated visual language.
6. For a reference site, copy the intended composition/asset relationship without importing unrelated style conventions that conflict with the current project's system.

## Verification

- Compare the touched component with at least one adjacent/shared usage when relevant.
- Check mobile/tablet/desktop behavior for layout changes.
- Check focus/interaction states for touched controls.
- Confirm no new raw token/value is introduced when an equivalent project token already exists.
