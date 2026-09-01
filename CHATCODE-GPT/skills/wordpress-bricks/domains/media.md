# Media and icon domain

Use for reference-site images, media import/mapping, attachment reuse, logos, certifications, SVG assets and functional icons.

## Media contract

1. Resolve media per semantic slot: `slot -> reference component/selector -> source URL -> attachment ID -> allow_reuse`.
2. Default `allow_reuse=false`. Reuse is valid only when the design intentionally uses the same asset in multiple slots.
3. Do not choose the first image from a whole-page scrape or a keyword score when the exact component/source cannot be proven.
4. Unresolved slots stay unresolved and are reported as such.
5. After import/mapping, verify source URL, dimensions/aspect intent, alt text and duplicate attachment IDs across repeated items.

## Icon contract

1. Functional icons use Bricks Icon elements, Bricks icon controls or a verified icon class/library already loaded by the project.
2. Repeater/custom-element icon choices should be Builder-editable when ordinary content is editable.
3. Brand marks, Zalo, certifications and unique logos use real media/SVG assets rather than pretending to be generic UI icons.
4. Do not embed `<i>` markup inside ordinary text values and do not keep large SVG data URIs in PHP.

## Verification

- Different semantic slots are not accidentally mapped to the same attachment.
- Rendered media is not stretched to fit the layout.
- Functional icon source exists and is aligned/accessible in its control context.
