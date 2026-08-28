const assert = require('assert/strict');
const { installRuntimePatches } = require('../core/runtime-bootstrap');
const { normalizeError } = require('../core/errors');

installRuntimePatches();

const { createProjectService } = require('../core/projects');
const { createSafeToolApi } = require('../core/safety-tools');

const state = {
  projects:[],
  settings:{ activityNotifications:false }
};

const store = {
  read:() => state,
  write:() => state,
  settings:() => ({ activityNotifications:false }),
  getProject:ref => {
    const error = new Error(`Unexpected persisted project lookup: ${String(ref)}`);
    error.code = 'FILE_NOT_FOUND';
    throw error;
  },
  fullPermissions:{ write:true, manageFiles:true, tasks:true, gitWrite:true },
  defaultSafety:{},
  normalizeSafety:value => value || {}
};

const approvals = {
  request:async () => ({ required:false, status:'not_required', approval_id:null }),
  status:() => null
};
const backups = {
  snapshot:async () => null
};

(async () => {
  const projects = createProjectService(store);
  const api = createSafeToolApi(projects, store, approvals, backups, {});

  const baseProjects = projects.toolApi.listProjects();
  const virtual = baseProjects.find(item => item.name === 'CHATCODE-GPT');
  assert.ok(virtual, 'Project service must expose CHATCODE-GPT');
  assert.equal(virtual.read_only, true);
  assert.equal(virtual.root, 'builtin://CHATCODE-GPT');
  assert.deepEqual(virtual.permissions, { write:false, manageFiles:false, tasks:false, gitWrite:false });

  const listed = api.listProjects();
  const safeVirtual = listed.find(item => item.name === 'CHATCODE-GPT');
  assert.ok(safeVirtual, 'Final Safe/Trusted API must preserve CHATCODE-GPT');
  assert.equal(safeVirtual.safety_mode, 'builtin_read_only');

  const files = await api.listFiles('CHATCODE-GPT', 5000);
  assert.ok(files.includes('skills/wordpress-bricks/SKILL.md'), 'SKILL.md must be discoverable with legacy list_files');
  assert.ok(files.includes('skills/wordpress-bricks/manifest.json'), 'manifest must be discoverable with legacy list_files');

  const skill = await api.readFile('CHATCODE-GPT', 'skills/wordpress-bricks/SKILL.md');
  assert.match(skill.content, /WordPress/i);
  assert.match(skill.content, /Bricks/i);

  const batch = await api.readFiles('chatcode-gpt-skills', [
    'skills/wordpress-bricks/manifest.json',
    'skills/wordpress-bricks/resources/validation.md'
  ]);
  assert.equal(batch.length, 2);
  assert.ok(batch.every(item => typeof item.content === 'string' && item.content.length > 10));

  const search = await api.search('CHATCODE-GPT', 'wordpress bricks');
  assert.ok(search.some(item => item.path === 'skills/wordpress-bricks/SKILL.md'), 'legacy search_project must find the Bricks skill');

  await assert.rejects(
    () => api.readFile('CHATCODE-GPT', '../package.json'),
    error => normalizeError(error).code === 'PATH_OUTSIDE_PROJECT'
  );

  for (const [name, args] of [
    ['writeFile', ['CHATCODE-GPT', 'skills/test.md', 'no']],
    ['deleteFile', ['CHATCODE-GPT', 'skills/wordpress-bricks/SKILL.md']],
    ['renameFile', ['CHATCODE-GPT', 'skills/a.md', 'skills/b.md']],
    ['runTask', ['CHATCODE-GPT', 'node --version']],
    ['gitStatus', ['CHATCODE-GPT']],
    ['gitDiff', ['CHATCODE-GPT', false]],
    ['gitStage', ['CHATCODE-GPT', ['skills/wordpress-bricks/SKILL.md']]],
    ['gitCommit', ['CHATCODE-GPT', 'should fail']]
  ]) {
    await assert.rejects(
      () => Promise.resolve(api[name](...args)),
      error => {
        const normalized = normalizeError(error);
        return normalized.code === 'PERMISSION_DENIED' && /read-only/i.test(normalized.message);
      },
      `${name} must be blocked for built-in skills`
    );
  }

  console.log(`Built-in skill compatibility PASS: ${files.length} files exposed through legacy 13-tool surface`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
