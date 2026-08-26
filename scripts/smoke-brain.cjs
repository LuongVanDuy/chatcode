const assert = require('assert/strict');
const { createBrainService } = require('../core/brain');

const files = ['package.json','src/index.tsx','src/api.ts','src/Button.tsx'];
const contents = {
  'package.json': JSON.stringify({name:'brain-demo',dependencies:{react:'^19.0.0',vite:'^7.0.0'}}),
  'src/index.tsx': `import React from 'react';\nimport { fetchUser } from './api';\nimport { Button } from './Button';\nexport function App() {\n  fetchUser();\n  return <Button />;\n}\n`,
  'src/api.ts': `export async function fetchUser() {\n  return { id: 1 };\n}\n`,
  'src/Button.tsx': `import React from 'react';\nexport const Button = () => <button>OK</button>;\n`
};

const store = {
  getProject(ref) { if (ref !== 'demo') throw new Error('not found'); return { id:'demo', name:'demo', root:'C:/demo' }; }
};
const projects = {
  status() { return { id:'demo', fileCount:files.length, updatedAt:'2026-08-26T00:00:00.000Z', dirty:false }; },
  toolApi: {
    async listFiles() { return files; },
    async readFile(_ref, rel) { return { path:rel, content:contents[rel] || '' }; }
  }
};

(async () => {
  const brain = createBrainService(store, projects);
  const overview = await brain.projectBrain('demo');
  assert.ok(overview.frameworks.some(x => x.name === 'React'), 'React not detected');
  assert.ok(overview.frameworks.some(x => x.name === 'Vite'), 'Vite not detected');
  assert.ok(overview.stats.symbols >= 3, 'symbols not indexed');
  assert.ok(overview.stats.dependencyEdges >= 2, 'local imports not resolved');

  const symbols = await brain.findSymbols('demo', 'fetchUser');
  assert.ok(symbols.some(x => x.name === 'fetchUser' && x.path === 'src/api.ts'), 'fetchUser definition missing');

  const refs = await brain.findReferences('demo', 'fetchUser');
  assert.ok(refs.definitions.some(x => x.path === 'src/api.ts'), 'definition missing');
  assert.ok(refs.references.some(x => x.path === 'src/index.tsx'), 'reference missing');

  const related = await brain.relatedFiles('demo', 'src/api.ts');
  assert.ok(related.some(x => x.path === 'src/index.tsx'), 'reverse dependency missing');

  const context = await brain.projectContext('demo', 'fetch user button');
  assert.ok(context.files.some(x => x.path === 'src/api.ts'), 'task context missing api file');
  assert.ok(context.files.some(x => x.path === 'src/Button.tsx'), 'task context missing component');

  brain.shutdown();
  console.log(`Project Brain smoke passed: ${overview.stats.symbols} symbols, ${overview.stats.dependencyEdges} dependency edges`);
})().catch(error => { console.error(error); process.exit(1); });
