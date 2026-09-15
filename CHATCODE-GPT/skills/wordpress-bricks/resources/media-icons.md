# Media & Icons — WordPress + Bricks

Legacy/compatibility resource. Modern tasks receive `domains/media.md`, but the same evidence rules apply here.

## Attachment ID safety

WordPress attachment IDs are site-local database identifiers.

- Never hardcode an attachment ID from chat history, a previous task/project, a file name, a source URL, screenshot or visual guess.
- Before persisting an ID into Bricks settings, PHP, post meta or options, verify that ID directly against the **current prepared WordPress project** during the same task.
- If the target media cannot be proven, keep the slot unresolved and report it instead of substituting an old/nearby attachment.
- Cross-site/reference URLs may identify the source asset, but they are not target-site attachment IDs.

Use a slot mapping for multi-image work:

```text
semantic slot -> reference/source asset -> current-project attachment -> verified ID -> allow_reuse
```

Default `allow_reuse=false`. Reuse one attachment only when the design intentionally uses the same asset in multiple semantic slots.

## Import/mapping checks

After import or mapping, verify:

- target attachment exists in current project;
- source URL/file corresponds to the intended semantic slot;
- dimensions/aspect ratio suit the design intent;
- alt text is appropriate;
- unrelated repeated items did not receive the same attachment ID accidentally.

Do not stretch media to satisfy layout. Define the display ratio independently and use `cover`/`contain` according to whether frame fill or full-subject preservation matters.

## Functional icons

Prefer Bricks-native icon infrastructure:

1. Bricks Icon element or icon control.
2. Verified icon library/set already registered by the target project.
3. Bricks 2.3.13 custom icon sets or Dynamic Data when the project uses them.
4. SVG/media assets for brand marks, certifications and unique logos.

Do not:

- infer an icon library from a class copied from another site;
- embed `<i>` markup inside ordinary text fields;
- store large SVG data URIs in PHP;
- treat built-in Themify/FontAwesome/Ionicons as a closed list when custom icon sets exist.

Builder-editable repeaters/custom elements should expose icon/media controls when those values are ordinary editor-owned content.

## Completion

A media task is not complete merely because an upload/write succeeded. Verify the current project attachment mapping and, when a live rendered check is available, confirm the actual frontend crop/source. If live verification cannot run, state that limitation rather than claiming visual PASS.
