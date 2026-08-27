const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWordPressBricksSkill, skillsForTask } = require('../core/skill-runtime');
const { createAgentRuntime } = require('../core/agent-runtime');

const root = path.join(__dirname, '..');
const skillRoot = path.join(root, 'CHATCODE-GPT', 'skills', 'wordpress-bricks');

function collectText(dir) {
  const files = [];
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes:true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:md|json)$/i.test(entry.name)) files.push(full);
    }
  };
  walk(dir);
  return { files, text:files.map(file => fs.readFileSync(file, 'utf8')).join('\n') };
}

(async () => {
  assert.equal(fs.existsSync(path.join(skillRoot, 'manifest.json')), true, 'manifest missing');
  assert.equal(fs.existsSync(path.join(skillRoot, 'SKILL.md')), true, 'SKILL.md missing');

  const collected = collectText(skillRoot);
  const text = collected.text;
  const lower = text.toLowerCase();

  assert.equal(lower.includes('tongkhokhoathongminh.com'), false, 'skill must not depend on reference project domain');
  assert.equal(lower.includes('tkk-'), false, 'skill must not copy a reference-project prefix');

  for (const required of [
    'bricks native',
    'seed once',
    'targeted migration',
    'migration marker',
    'regenerate bricks css',
    'wordpress menu',
    'desktop',
    'tablet',
    'mobile',
    'product archive',
    'single product',
    'checkout',
    'thank-you',
    'mini-cart',
    'custom bricks element',
    'inc/setup/',
    'inc/header/',
    'inc/home/',
    'inc/blog/',
    'inc/shop/',
    'inc/product/',
    'assets/css/',
    'assets/js/',
    'wordpress core',
    'bricks parent theme',
    'woocommerce core'
  ]) {
    assert.equal(lower.includes(required), true, `missing required skill contract: ${required}`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.id, 'wordpress-bricks');
  assert.ok(Array.isArray(manifest.resources) && manifest.resources.length >= 4, 'skill resources incomplete');

  const bricksInspect = {
    project:{ id:'p1', name:'fixture' },
    primary_language:'PHP',
    frameworks:[{ name:'WordPress' }, { name:'WooCommerce' }],
    framework_names:['WordPress', 'WooCommerce'],
    wordpress:{ isWordPress:true, parentThemes:[{ slug:'bricks', root:'wp-content/themes/bricks' }], childThemes:[{ slug:'fixture-child', template:'bricks' }] },
    relevant_files:[{ path:'wp-content/themes/fixture-child/functions.php' }],
    relevant_relations:[], top_symbols:[], entrypoints:[], git:{ clean:true }
  };

  const skill = loadWordPressBricksSkill(bricksInspect, 'Migrate one Bricks element ID and regenerate CSS cache');
  assert.ok(skill, 'Bricks skill must activate from project evidence');
  assert.equal(skill.id, 'wordpress-bricks');
  assert.ok(skill.instructions.includes('Seed once'), 'entry instructions were not loaded');
  assert.ok(skill.resources.some(item => item.name === 'resources/migrations.md'), 'migration resource must load for migration task');
  assert.ok(skill.resources.some(item => item.name === 'resources/validation.md'), 'validation resource must always load');

  const plainWpInspect = {
    project:{ id:'p2', name:'plain-wp' },
    framework_names:['WordPress'],
    frameworks:[{ name:'WordPress' }],
    wordpress:{ isWordPress:true, parentThemes:[{ slug:'twentytwentysix' }] },
    relevant_files:[]
  };
  assert.equal(skillsForTask(plainWpInspect, 'Fix a PHP helper').length, 0, 'Bricks skill must not activate for unrelated WordPress project');

  const fakeApi = {
    startWork: async () => ({ work_session_id:'work-1', project_id:'p1', workspace_mode:'trusted', baseline:{} }),
    inspectProject: async () => bricksInspect,
    readFile: async () => { throw new Error('no package.json in fixture'); }
  };
  const prepared = await createAgentRuntime(fakeApi).prepareTask('p1', 'Fix the Bricks mobile menu without duplicating menu data');
  assert.equal(prepared.skills.length, 1, 'prepare_task must attach one Bricks skill');
  assert.equal(prepared.skills[0].id, 'wordpress-bricks');
  assert.match(prepared.agent_contract.guidance[0], /skills/i, 'agent contract must make attached skills mandatory');

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(pkg.build.files.includes('CHATCODE-GPT/**/*'), 'installer package must include CHATCODE-GPT skills');
  assert.equal(pkg.scripts['test:wordpress-bricks-skill'], 'node scripts/smoke-wordpress-bricks-skill.cjs');

  console.log(`WordPress + Bricks skill PASS: ${collected.files.length} skill files, independent contract + prepare_task activation OK`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
