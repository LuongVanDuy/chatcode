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
assert.ok(core.includes('default new-file budget is zero'));
assert.ok(core.includes('normal code/layout/template edit is **not** a migration'));

assert.ok(organization.includes('file creation budget: existing owner first'));
assert.ok(organization.includes('normal change should usually create **zero new source files**'));
assert.ok(organization.includes('site-parts.php'));
assert.ok(organization.includes('site-parts-migration.php'));
assert.ok(organization.includes('vague pair created for one normal feature'));

assert.ok(migrations.includes('migration threshold'));
assert.ok(migrations.includes('these are **not migrations by default**'));
assert.ok(migrations.includes('initial implementation of a new site/header/footer/page/section'));
assert.ok(migrations.includes('do **not** create `*-migration.php` merely because a task touches bricks'));
assert.ok(migrations.includes('proven independent migration lifecycle'));

assert.ok(skill.includes('do not broad-search unrelated websites merely for inspiration'));
assert.ok(skill.includes('a normal edit defaults to zero new source files'));
assert.ok(skill.includes('migration has a threshold'));

const initialHeader = chooseResources(
  manifest,
  'Build the initial Header and Footer for this new Bricks site using the existing child theme files'
);
assert.ok(initialHeader.includes('resources/templates.md'));
assert.equal(initialHeader.includes('resources/migrations.md'), false, 'initial header/footer build must not route migrations');

const normalSetup = chooseResources(
  manifest,
  'Add the homepage header setup in the existing child theme and keep the implementation small'
);
assert.equal(normalSetup.includes('resources/migrations.md'), false, 'normal setup must not route migrations');

const persistedMigration = chooseResources(
  manifest,
  'Migrate the existing persisted Bricks Builder data: change one element id while preserving parent children relations and rollback safely'
);
assert.ok(persistedMigration.includes('resources/migrations.md'), 'real persisted Builder migration must route migration rules');

const referenceBuild = chooseResources(
  manifest,
  'Build boncauinax homepage like https://thietbivesinhgiakho.vn and copy its available images/icons; do not research other sites'
);
assert.ok(referenceBuild.includes('resources/core-checklist.md'));

console.log('Focused Bricks delivery PASS: reference scope + zero-file default + migration threshold');
