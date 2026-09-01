const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chooseResources } = require('../core/skill-runtime');

const root = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const core = fs.readFileSync(path.join(root, 'resources', 'core-checklist.md'), 'utf8').toLowerCase();
const organization = fs.readFileSync(path.join(root, 'resources', 'code-organization.md'), 'utf8').toLowerCase();
const migrations = fs.readFileSync(path.join(root, 'resources', 'migrations.md'), 'utf8').toLowerCase();
const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').toLowerCase();

assert.ok(core.includes('keep external references scoped'));
assert.ok(core.includes('do not broad-search unrelated websites'));
assert.ok(core.includes('normal edit new-file budget is zero'));
assert.ok(core.includes('a normal code/layout/template change is not a migration'));
assert.ok(core.includes('one-time setup must terminate'));

assert.ok(organization.includes('preferred wordpress + bricks child-theme architecture'));
assert.ok(organization.includes('functions.php                 # bootstrap/enqueue only'));
assert.ok(organization.includes('inc/core/helpers.php'));
assert.ok(organization.includes('inc/core/templates.php'));
assert.ok(organization.includes('inc/setup/media.php'));
assert.ok(organization.includes('inc/setup/menus.php'));
assert.ok(organization.includes('inc/templates/header.php'));
assert.ok(organization.includes('inc/templates/footer.php'));
assert.ok(organization.includes('elements/product-support.php'));
assert.ok(organization.includes('assets/css/main.css'));
assert.ok(organization.includes('file creation budget: existing owner first'));
assert.ok(organization.includes('normal change should usually create **zero new source files**'));
assert.ok(organization.includes('site-parts-migration.php'));

assert.ok(migrations.includes('migration threshold'));
assert.ok(migrations.includes('these are **not migrations by default**'));
assert.ok(migrations.includes('initial implementation of a new site/header/footer/page/section'));
assert.ok(migrations.includes('do **not** create `*-migration.php` merely because a task touches bricks'));

assert.ok(skill.includes('do not broad-search unrelated websites'));
assert.ok(skill.includes('a normal edit defaults to zero new source files'));
assert.ok(skill.includes('normal layout/template/setup work is not a migration'));
assert.ok(skill.includes('one-time setup must have an end state'));

const architectureTask = chooseResources(manifest, 'Reorganize Bricks child theme files and prefix/namespace ownership');
assert.deepEqual(architectureTask, ['resources/core-checklist.md', 'resources/code-organization.md']);

const initialHeader = chooseResources(manifest, 'Build the initial Header and Footer for this new Bricks site using existing child theme files');
assert.deepEqual(initialHeader, ['resources/core-checklist.md', 'resources/templates.md']);

const normalSetup = chooseResources(manifest, 'Add the homepage header setup in the existing child theme and keep implementation small');
assert.equal(normalSetup.includes('resources/migrations.md'), false);

const persistedMigration = chooseResources(manifest, 'Migrate existing persisted Bricks Builder data: change one element id while preserving parent children relations and rollback safely');
assert.deepEqual(persistedMigration, ['resources/core-checklist.md', 'resources/migrations.md']);

const referenceBuild = chooseResources(manifest, 'Build homepage like the named reference site and copy its exact available images/icons; do not research other sites');
assert.deepEqual(referenceBuild, ['resources/core-checklist.md', 'resources/media-icons.md']);

console.log('Focused Bricks delivery PASS: scoped reference + zero-file default + migration lifecycle + media routing');
