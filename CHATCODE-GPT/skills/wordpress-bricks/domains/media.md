# Media and icon domain

Use for reference-site images, media import/mapping, attachment reuse, logos, certifications, SVG assets and functional icons.

## Media ID contract

1. WordPress attachment IDs are **site-local evidence**. Never hardcode an ID from chat history, another project/task, a URL, file name or visual guess.
2. Resolve media per semantic slot: `slot -> current project source/attachment evidence -> source URL -> verified attachment ID -> allow_reuse`.
3. Default `allow_reuse=false`. Reuse is valid only when the design intentionally uses the same asset in multiple slots.
4. Verify the attachment directly against the current WordPress project in the same prepared task before writing the ID into Bricks/PHP/meta.
5. Do not choose the first image from a whole-page scrape or keyword score when the exact component/source cannot be proven.
6. Unresolved slots stay unresolved and are reported as such.
7. After import/mapping, verify source URL, dimensions/aspect intent, alt text and duplicate attachment IDs across repeated items.

## Icon contract

1. Functional icons use Bricks Icon elements, Bricks icon controls or a verified icon set already loaded by the target project.
2. Bricks 2.3.13 supports built-in/custom icon sets, SVG media and Dynamic Data; do not treat the built-in library list as a closed enum.
3. Repeater/custom-element icon choices should be Builder-editable when ordinary content is editable.
4. Brand marks, Zalo, certifications and unique logos use real media/SVG assets rather than pretending to be generic UI icons.
5. Do not embed `<i>` markup inside ordinary text values and do not keep large SVG data URIs in PHP.

## Verification

- Every persisted attachment ID was verified on the current project during the current task.
- Different semantic slots are not accidentally mapped to the same attachment.
- Rendered media is not stretched to fit the layout.
- Functional icon source exists and is aligned/accessible in its control context.
