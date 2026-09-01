const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chooseResources, routeSkillDomains } = require('../core/skill-runtime');

const root = path.join(__dirname, '..', 'CHATCODE-GPT', 'skills', 'wordpress-bricks');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const core = fs.readFileSync(path.join(root, 'resources', 'core-checklist.md'), 'utf8').toLowerCase();
const organization = fs.readFileSync(path.join(root, 'resources', 'code-organization.md'), 'utf8').toLowerCase();
const migrations = fs.readFileSync(path.join(root, 'resources', 'migrations.md'), 'utf8').toLowerCase();
const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8').toLowerCase();
const dataDomain = fs.readFileSync(path.join(root, 'domains', 'data.md'), 'utf8').toLowerCase();
const mediaDomain = fs.readFileSync(path.join(root, 'domains', 'media.md'), 'utf8').toLowerCase();

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

// v5 umbrella owns cross-cutting scope; detailed lifecycle/media rules live in their domain packs.
assert.ok(skill.includes('when a reference site/domain is named'));
assert.ok(skill.includes('a normal edit defaults to zero new source files'));
assert.ok(skill.includes('do not broaden into git, external research, migration, refactor or deployment'));
assert.ok(skill.includes('one-time setup/migration must reach a terminal no-op state'));
assert.ok(dataDomain.includes('initial setup from migration'));
assert.ok(dataDomain.includes('one-time work must have an end state'));
assert.ok(mediaDomain.includes('default `allow_reuse=false`'));
assert.ok(mediaDomain.includes('unresolved slots stay unresolved'));

const architectureTask = chooseResources(manifest, 'Reorganize Bricks child theme files and prefix/namespace ownership');
assert.deepEqual(architectureTask, ['resources/core-checklist.md', 'resources/code-organization.md']);

const initialHeader = chooseResources(manifest, 'Build the initial Header and Footer for this new Bricks site using existing child theme files');
assert.deepEqual(initialHeader, ['resources/core-checklist.md', 'resources/templates.md']);

const normalSetup = chooseResources(manifest, 'Add the homepage header setup in the existing child theme and keep implementation small');
assert.equal(normalSetup.includes('resources/migrations.md'), false);

const persistedMigration = chooseResources(manifest, 'Migrate existing persisted Bricks Builder data: change one element id while preserving parent children relations and rollback safely');
assert.deepEqual(persistedMigration, ['resources/core-checklist.md', 'resources/migrations.md']);
assert.deepEqual(routeSkillDomains('Migrate existing persisted Bricks Builder data and element id safely', null, { type:'DATA' }), ['data','bricks']);

const referenceBuild = chooseResources(manifest, 'Build homepage like the named reference site and copy its exact available images/icons; do not research other sites');
assert.deepEqual(referenceBuild, ['resources/core-checklist.md', 'resources/media-icons.md']);
assert.equal(routeSkillDomains('Copy exact reference images and icons', null)[0], 'media');

console.log('Focused Bricks delivery PASS: v5 umbrella scope + domain-owned migration/media discipline');
