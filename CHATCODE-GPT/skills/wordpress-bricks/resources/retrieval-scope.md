# Scope-first WordPress project retrieval

Use this contract when discovering, searching, reading, auditing, or expanding source context in WordPress + Bricks projects. The goal is to keep ChatGPT focused on project-owned code without losing the ability to inspect framework/core source when there is a real reason.

## Index broadly, fetch narrowly

Project Brain may index broad project metadata and source relationships locally. **Indexing is not permission to inject all indexed source content into the task context.**

Default source-content retrieval order:

1. active/detected Bricks child-theme code relevant to the task;
2. directly relevant project-owned/custom plugin code returned by Brain/search;
3. other project-owned `wp-content` code only when evidence points there;
4. Bricks parent theme as a read-only API/source reference only when required;
5. WooCommerce/third-party plugin core as a read-only reference only when required;
6. WordPress root/core only for an explicit core/bootstrap/API investigation or concrete dependency evidence.

Never edit WordPress core, Bricks parent theme, WooCommerce core, third-party plugin core, or vendor code merely because it was inspected as reference.

## Search before read

Preferred discovery flow:

```text
Project Brain / symbol search / targeted text search
-> ranked candidate files
-> read the smallest useful candidate set
-> follow concrete include/import/hook/symbol/data-owner evidence
-> widen scope only if the current evidence is insufficient
```

Do not use this flow:

```text
list everything
-> read many directories/files just in case
-> decide relevance afterward
```

For ordinary WordPress work, first-pass content should normally be **4–6 files or fewer**. If only two files are clearly relevant, read two; do not pad context to an arbitrary count.

## Default narrow scope

Normal tasks such as Header/Footer, homepage sections, frontend CSS, Bricks custom elements, shared product/post cards, template integration, AJAX handlers, and project-owned helpers should start inside the relevant child theme and directly related custom plugin code.

Do not fetch these areas by default:

- `wp-admin/`;
- `wp-includes/`;
- WordPress root bootstrap files;
- Bricks parent-theme source;
- `wp-content/plugins/woocommerce/` core source;
- unrelated third-party plugins;
- `wp-content/uploads/`;
- `vendor/`, `node_modules/`;
- cache, backups, generated logs, minified vendor assets.

These are not absolute bans. They are **on-demand reference scopes**.

## Evidence-driven expansion

A wider read is justified when at least one concrete reason exists, for example:

- a scoped file includes/requires/imports another file;
- a called symbol/helper/class is defined outside the current scope;
- a WordPress/Bricks/Woo hook or API contract cannot be confirmed from the skill/public project code;
- the user explicitly asks to inspect a parent/core implementation;
- a failing stack trace points to that source;
- Brain/search returns no useful project-owned candidate and the top ranked reference source is required to understand behavior.

When widening scope, expand **one tier at a time**:

```text
child theme
-> relevant custom plugin
-> Bricks parent / relevant third-party API source
-> broader wp-content
-> WordPress root/core
```

Do not jump directly to a whole-project/core scan.

## Framework/core reference rules

### Bricks parent theme

Read only when the task genuinely needs the installed Bricks implementation, such as verifying an element/control class, hook, method, storage contract, or behavior not already established by the skill/current project.

A normal request to create or style a Bricks element is not by itself a reason to read the parent theme.

### WooCommerce core

A product/cart/checkout task does not automatically justify reading WooCommerce core. Start from project integration and the known public Woo contract. Read exact Woo core source only when verifying a specific hook/class/API behavior is necessary.

### WordPress core

Read `wp-admin`, `wp-includes`, or root bootstrap source only for explicit WordPress-core/bootstrap investigation or concrete evidence that the task depends on that implementation. Never read WordPress core merely to fill context.

## Root files and build tooling

Do not probe project-root files such as `package.json`, `composer.json`, `.htaccess`, or `wp-config.php` on every WordPress task. Read them only when the request or ranked evidence makes them relevant. Sensitive-file policy still applies independently.

## Completion behavior

- Keep the fetched-content set minimal and task-relevant.
- Follow dependencies rather than guessing neighboring files.
- If scope was widened beyond project-owned `wp-content`, preserve the reason in task context/telemetry when available.
- Never claim a core/plugin implementation was inspected if it was not actually read.

The governing rule is: **Project Brain may know broadly; ChatGPT should read narrowly. Search first, fetch exact source, expand only on evidence.**
