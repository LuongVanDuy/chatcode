const { chatError } = require('./errors');
const { extractNodes } = require('./bricks-validator');
const { WORDPRESS_BRICKS_SKILL_ID } = require('./skill-runtime');

const HARDENING_VERSION = 1;
const MAX_EVIDENCE_ITEMS = 800;

const HARDENING_RULES = [
  'Bricks evidence hardening:',
  '- Existing Bricks element IDs used by selectors/query targets/migrations must be evidenced from the current task persisted tree. Reading chat history or frontend DOM does not count.',
  '- Numeric WordPress media IDs introduced by the patch must be verified as live attachment posts in the current WordPress project (for example WP-CLI `wp post get <id> --field=post_type` returning `attachment`).',
  '- `#brxe-*` and `[data-field-id]` selectors are linted before mutation. Prefer semantic/global classes; unverified generated IDs are blocked.',
  '- New top-level PHP function/class/interface/trait names are checked against Project Brain before the patch is applied. Existing registrations found for new hooks are surfaced as duplicate warnings.',
  '- Completion distinguishes code verification, deployment and live/responsive verification. ChatCode never promotes write/upload success to live visual PASS.'
].join('\n');

function normalizeRef(value) { return String(value || '').trim().toLowerCase(); }
function normalizePath(value) { return String(value || '').replace(/\\/g,'/').replace(/^\.?\/?[ab]\//,'').replace(/^\/+/, ''); }
function uniq(values) { return [...new Set((values || []).filter(Boolean))]; }
function asArray(value) { return Array.isArray(value) ? value : []; }
function isTerminal(value) { return /^(?:completed|finished|rolled_back|cancelled|canceled|failed|deploy_failed)$/i.test(String(value || '')); }

function parseJson(value) {
  try { return JSON.parse(String(value || '')); } catch { return null; }
}

function extractPersistedElementIds(text) {
  const raw = String(text || '');
  const ids = new Set();
  const parsed = parseJson(raw);
  if (parsed != null) {
    try {
      const extracted = extractNodes(parsed);
      if (extracted?.recognized) {
        for (const node of extracted.nodes || []) {
          const id = String(node?.id || '');
          if (/^[A-Za-z0-9]{6}$/.test(id)) ids.add(id);
        }
      }
    } catch {}
  }
  // Support source/export files that contain PHP/JSON-like Bricks node arrays.
  const re = /["']id["']\s*(?::|=>)\s*["']([A-Za-z0-9]{6})["']/g;
  let match;
  while ((match = re.exec(raw))) {
    const around = raw.slice(Math.max(0, match.index - 260), Math.min(raw.length, re.lastIndex + 420));
    if (/["']name["']\s*(?::|=>)/.test(around) && /["'](?:parent|children|settings)["']\s*(?::|=>)/.test(around)) ids.add(match[1]);
  }
  return [...ids];
}

function diffFiles(patch) {
  const files = [];
  let current = null;
  for (const line of String(patch || '').replace(/\r\n/g,'\n').split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = normalizePath(line.slice(4).split('\t')[0]);
      current = { path:path === 'dev/null' ? '' : path, added:[], removed:[] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('+') && !line.startsWith('+++')) current.added.push(line.slice(1));
    else if (line.startsWith('-') && !line.startsWith('---')) current.removed.push(line.slice(1));
  }
  return files.filter(file => file.path);
}

function collectDefinedElementIds(text) {
  const raw = String(text || '');
  const ids = new Set();
  const re = /["']id["']\s*(?::|=>)\s*["']([A-Za-z0-9]{6})["']/g;
  let match;
  while ((match = re.exec(raw))) {
    const around = raw.slice(Math.max(0,match.index - 180), Math.min(raw.length,re.lastIndex + 360));
    if (/["']name["']\s*(?::|=>)/.test(around) && /["'](?:parent|children|settings)["']\s*(?::|=>)/.test(around)) ids.add(match[1]);
  }
  return ids;
}

function extractPatchEvidenceRefs(patch) {
  const files = diffFiles(patch);
  const elementRefs = new Set(), mediaRefs = new Set(), generatedSelectors = new Set();
  const defined = new Set();
  let dataFieldSelectorCount = 0;

  for (const file of files) {
    const added = file.added.join('\n');
    for (const id of collectDefinedElementIds(added)) defined.add(id);
    let match;
    const brxe = /#brxe-([A-Za-z0-9]{6})\b/g;
    while ((match = brxe.exec(added))) { elementRefs.add(match[1]); generatedSelectors.add(match[1]); }
    const target = /(?:["']?(?:queryId|filterQueryId)["']?)\s*(?::|=>)\s*["']([A-Za-z0-9]{6})["']/g;
    while ((match = target.exec(added))) elementRefs.add(match[1]);
    const parent = /["']parent["']\s*(?::|=>)\s*["']([A-Za-z0-9]{6})["']/g;
    while ((match = parent.exec(added))) elementRefs.add(match[1]);
    const children = /["']children["']\s*(?::|=>)\s*\[([^\]]{0,1200})\]/g;
    while ((match = children.exec(added))) {
      for (const id of match[1].match(/[A-Za-z0-9]{6}/g) || []) elementRefs.add(id);
    }
    dataFieldSelectorCount += (added.match(/\[data-field-id(?:\s*=|\])/g) || []).length;

    const mediaCall = /\bwp_get_attachment_(?:url|image|metadata|caption|image_src)\s*\(\s*(\d{1,12})\b/g;
    while ((match = mediaCall.exec(added))) mediaRefs.add(match[1]);
    const thumb = /\bupdate_post_meta\s*\([^,]+,\s*["']_thumbnail_id["']\s*,\s*(\d{1,12})\b/g;
    while ((match = thumb.exec(added))) mediaRefs.add(match[1]);
    const attachment = /["']attachment_id["']\s*(?::|=>)\s*(\d{1,12})\b/g;
    while ((match = attachment.exec(added))) mediaRefs.add(match[1]);
    const numericId = /["']id["']\s*(?::|=>)\s*(\d{1,12})\b/g;
    while ((match = numericId.exec(added))) {
      const around = added.slice(Math.max(0,match.index - 260), Math.min(added.length,numericId.lastIndex + 300));
      if (/(?:image|media|attachment|logo|thumbnail|background)/i.test(around) && /(?:url|filename|size|full)/i.test(around)) mediaRefs.add(match[1]);
    }
  }
  for (const id of defined) elementRefs.delete(id);
  return {
    files,
    element_refs:[...elementRefs],
    media_refs:[...mediaRefs].filter(id => Number(id) > 0),
    generated_selectors:[...generatedSelectors],
    defined_element_ids:[...defined],
    data_field_selector_count:dataFieldSelectorCount
  };
}

function symbolDeclarations(lines = []) {
  const out = [];
  for (const line of lines) {
    let match = /^function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (match) out.push({ name:match[1], kind:'function' });
    match = /^(?:(?:final|abstract)\s+)?(class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (match) out.push({ name:match[2], kind:match[1] });
  }
  return out;
}

function hookRegistrations(lines = []) {
  const text = lines.join('\n');
  const out = [];
  const re = /\b(add_action|add_filter)\s*\(\s*(["'])([^"']+)\2\s*,\s*([^,\)]+)/g;
  let match;
  while ((match = re.exec(text))) {
    const callback = String(match[4] || '').replace(/[^A-Za-z0-9_:>$-]/g,'').slice(0,120);
    out.push({ type:match[1], hook:match[3], callback });
  }
  return out;
}

async function phpDuplicatePreflight(api, projectRef, patch) {
  const errors = [], warnings = [], checked = [];
  const files = diffFiles(patch).filter(file => /\.php$/i.test(file.path));
  for (const file of files) {
    const removedNames = new Set(symbolDeclarations(file.removed).map(item => `${item.kind}:${item.name}`));
    for (const symbol of symbolDeclarations(file.added)) {
      const key = `${symbol.kind}:${symbol.name}`;
      if (removedNames.has(key)) continue;
      checked.push({ type:'symbol', ...symbol, path:file.path });
      if (typeof api.findSymbols !== 'function') {
        warnings.push({ code:'PHP_DUPLICATE_SYMBOL_CHECK_UNAVAILABLE', symbol:symbol.name, kind:symbol.kind, path:file.path });
        continue;
      }
      let matches = [];
      try { matches = asArray(await api.findSymbols(projectRef,symbol.name,symbol.kind === 'function' ? 'function' : symbol.kind,20)); } catch {}
      const exact = matches.filter(item => String(item?.name || '') === symbol.name);
      if (exact.length) {
        errors.push({
          code:'PHP_DUPLICATE_PUBLIC_SYMBOL', symbol:symbol.name, kind:symbol.kind, path:file.path,
          existing:exact.slice(0,6).map(item => ({ path:item.path || item.file || '', line:item.line || null, owner:item.owner || null }))
        });
      }
    }

    const removedHooks = new Set(hookRegistrations(file.removed).map(item => `${item.type}:${item.hook}:${item.callback}`));
    for (const hook of hookRegistrations(file.added)) {
      const key = `${hook.type}:${hook.hook}:${hook.callback}`;
      if (removedHooks.has(key) || !hook.callback) continue;
      checked.push({ type:'hook', ...hook, path:file.path });
      if (typeof api.search !== 'function') {
        warnings.push({ code:'PHP_DUPLICATE_HOOK_CHECK_UNAVAILABLE', ...hook, path:file.path });
        continue;
      }
      let rows = [];
      try { rows = asArray(await api.search(projectRef,`${hook.hook} ${hook.callback}`)); } catch {}
      const duplicate = rows.find(row => {
        const snippet = String(row?.snippet || row?.content || '');
        return snippet.includes(hook.hook) && snippet.includes(hook.callback);
      });
      if (duplicate) warnings.push({
        code:'PHP_DUPLICATE_HOOK_CANDIDATE', ...hook, path:file.path,
        existing_path:duplicate.path || duplicate.file || ''
      });
    }
  }
  return { ok:errors.length === 0, errors, warnings, checked };
}

function ledgerSummary(ledger) {
  return {
    task_id:ledger.task_id,
    project_id:ledger.project_id,
    element_ids:[...ledger.element_ids.keys()],
    media_ids:[...ledger.media_ids.keys()],
    sources:ledger.sources.slice(-30),
    hardening_version:HARDENING_VERSION
  };
}

function addEvidence(map, id, source) {
  const key = String(id || '');
  if (!key) return false;
  if (!map.has(key) && map.size >= MAX_EVIDENCE_ITEMS) return false;
  const list = map.get(key) || [];
  if (!list.includes(source)) list.push(source);
  map.set(key,list.slice(-8));
  return true;
}

function recordElementText(ledger, text, source) {
  const ids = extractPersistedElementIds(text);
  for (const id of ids) addEvidence(ledger.element_ids,id,source);
  if (ids.length) ledger.sources.push({ type:'element-tree', source, ids:ids.slice(0,80) });
  return ids;
}

function recordWpCliEvidence(ledger, command, result) {
  const stdout = String(result?.stdout || '');
  if (result?.status !== 'completed' || Number(result?.exit_code || 0) !== 0) return { element_ids:[], media_ids:[] };
  const elementIds = [], mediaIds = [];
  if (/\bwp\b[^\n]*(?:post\s+meta\s+get|eval)[^\n]*(?:_bricks_page_(?:content|header|footer)_2|bricks_(?:components|global_queries|theme_styles))/i.test(command)) {
    elementIds.push(...recordElementText(ledger,stdout,`wp-cli:${String(command).slice(0,180)}`));
  }
  let match = /\bwp\s+post\s+get\s+(\d{1,12})\b[^\n]*--field[=\s]+post_type\b/i.exec(command);
  if (match && stdout.trim() === 'attachment') {
    addEvidence(ledger.media_ids,match[1],`wp-cli:${String(command).slice(0,180)}`);
    mediaIds.push(match[1]);
  } else {
    match = /\bwp\s+post\s+get\s+(\d{1,12})\b[^\n]*--format[=\s]+json\b/i.exec(command);
    const parsed = match ? parseJson(stdout) : null;
    if (match && parsed?.post_type === 'attachment' && String(parsed?.ID || parsed?.id || match[1]) === String(match[1])) {
      addEvidence(ledger.media_ids,match[1],`wp-cli:${String(command).slice(0,180)}`);
      mediaIds.push(match[1]);
    }
  }
  if (mediaIds.length) ledger.sources.push({ type:'wordpress-media', source:`wp-cli:${String(command).slice(0,180)}`, ids:mediaIds });
  return { element_ids:elementIds, media_ids:mediaIds };
}

function lintPatch(ledger, patch) {
  const refs = extractPatchEvidenceRefs(patch);
  const errors = [], warnings = [];
  const missingElements = refs.element_refs.filter(id => !ledger.element_ids.has(id));
  const missingMedia = refs.media_refs.filter(id => !ledger.media_ids.has(String(id)));
  if (missingElements.length) errors.push({
    code:'BRICKS_ELEMENT_ID_UNVERIFIED', ids:missingElements,
    message:'Patch references existing Bricks element IDs that are not evidenced from the current task persisted tree.'
  });
  if (missingMedia.length) errors.push({
    code:'WORDPRESS_MEDIA_ID_UNVERIFIED', ids:missingMedia,
    message:'Patch introduces WordPress media IDs that were not verified as live attachments in the current task/project.'
  });
  if (refs.data_field_selector_count) {
    const intentional = /data-field-id/i.test(String(ledger.request || ''));
    const item = {
      code:'BRICKS_DATA_FIELD_SELECTOR_COUPLING', count:refs.data_field_selector_count,
      message:'[data-field-id] is export/DOM coupling; prefer a project-controlled semantic/global class.'
    };
    if (intentional) warnings.push(item); else errors.push(item);
  }
  for (const id of refs.generated_selectors) {
    if (!missingElements.includes(id)) warnings.push({
      code:'BRICKS_GENERATED_SELECTOR_COUPLING', id,
      message:'Verified #brxe-* selector is allowed but remains coupled to a generated element ID; prefer a semantic/global class when possible.'
    });
  }
  return { ok:errors.length === 0, errors, warnings, refs };
}

function verificationState(result, ledger) {
  const codeVerified = result?.verification_passed === true;
  const ftp = result?.ftp_deploy || result?.session?.ftp_deploy || null;
  const deployStatus = ftp ? String(ftp.status || (ftp.ok ? 'completed' : 'failed')) : 'not_proven_or_not_required';
  const deployed = ftp ? ftp.ok === true : null;
  const ui = (ledger.domains || []).includes('ui') || /\b(?:ui|layout|css|responsive|mobile|tablet|desktop|frontend|giao\s+diện)\b/i.test(String(ledger.request || ''));
  const liveVerified = false;
  const responsiveVerified = false;
  let completionLevel = codeVerified ? 'code_verified' : 'verification_failed';
  if (codeVerified && deployed === false) completionLevel = 'deploy_failed';
  else if (codeVerified && ui && !liveVerified) completionLevel = 'code_verified_not_live_verified';
  return {
    code_verified:codeVerified,
    deployment:{ status:deployStatus, verified:deployed },
    live:{ required:ui, verified:liveVerified },
    responsive:{ required:ui, verified:responsiveVerified, viewports:ui ? ['desktop','tablet','mobile'] : [] },
    completion_level:completionLevel,
    user_claim_limit:ui && !liveVerified
      ? 'Do not claim the frontend/live visual result is PASS. Report that code/deploy verification is separate from live visual verification.'
      : null
  };
}

function createLedger(receipt, request = '') {
  return {
    task_id:String(receipt?.task_id || ''),
    project_id:String(receipt?.project_id || ''),
    project_name:String(receipt?.project_name || ''),
    request:String(request || ''),
    domains:asArray(receipt?.domains),
    element_ids:new Map(), media_ids:new Map(), sources:[]
  };
}

function createBricksEvidenceApi(api, store = null) {
  if (!api || api.__bricksEvidenceWrapped || typeof api.prepareTask !== 'function' || typeof api.completeTask !== 'function') return api;
  api.__bricksEvidenceWrapped = true;
  const original = {};
  for (const name of ['prepareTask','completeTask','readFile','readFiles','exec','findSymbols','search']) {
    if (typeof api[name] === 'function') original[name] = api[name].bind(api);
  }
  const ledgers = new Map();

  function project(ref) {
    try { return store?.getProject ? store.getProject(ref) : { id:String(ref || ''), name:String(ref || '') }; }
    catch { return { id:String(ref || ''), name:String(ref || '') }; }
  }
  function ledgersForProject(ref) {
    const p = project(ref);
    const keys = new Set([normalizeRef(p.id),normalizeRef(p.name)].filter(Boolean));
    return [...ledgers.values()].filter(item => keys.has(normalizeRef(item.project_id)) || keys.has(normalizeRef(item.project_name)));
  }
  function seedContext(ledger, context) {
    for (const item of asArray(context?.relevant_files)) {
      if (!item?.content) continue;
      recordElementText(ledger,item.content,`prepare:${item.path || item.file || 'context'}`);
    }
  }
  function hardenSkills(skills) {
    return asArray(skills).map(skill => skill?.id === WORDPRESS_BRICKS_SKILL_ID
      ? { ...skill, instructions:`${HARDENING_RULES}\n\n${String(skill.instructions || '')}`.trim(), evidence_hardening_version:HARDENING_VERSION }
      : skill);
  }

  api.prepareTask = async (ref, request, limit, options) => {
    const result = await original.prepareTask(ref,request,limit,options);
    const receipt = result?.skill_receipt;
    if (!receipt || receipt.skill_id !== WORDPRESS_BRICKS_SKILL_ID) return result;
    const ledger = createLedger(receipt,request);
    seedContext(ledger,result.context || {});
    ledgers.set(ledger.task_id,ledger);
    return {
      ...result,
      skills:hardenSkills(result.skills),
      bricks_evidence:ledgerSummary(ledger),
      bricks_evidence_policy:{
        hardening_version:HARDENING_VERSION,
        element_id:'Existing IDs must be evidenced from the current task persisted Bricks tree.',
        media_id:'Numeric attachment IDs must be live-verified in the current WordPress project.',
        task_reads:'Task-bound reads count automatically when this project has one active Bricks receipt; WP-CLI evidence must use the current work_session_id.',
        patch_lint:true,
        php_duplicate_preflight:true,
        live_verification_separate:true
      },
      verification_requirements:{
        responsive:(receipt.domains || []).includes('ui'),
        live_frontend:(receipt.domains || []).includes('ui'),
        claim_rule:'Write/upload success is not live visual PASS.'
      }
    };
  };

  if (original.readFile) {
    api.readFile = async (ref, rel, ...args) => {
      const result = await original.readFile(ref,rel,...args);
      const active = ledgersForProject(ref);
      if (active.length === 1 && result?.content) {
        const ids = recordElementText(active[0],result.content,`read:${rel}`);
        if (ids.length) return { ...result, bricks_evidence_recorded:{ task_id:active[0].task_id, element_ids:ids } };
      }
      return result;
    };
  }

  if (original.readFiles) {
    api.readFiles = async (ref, paths, ...args) => {
      const result = await original.readFiles(ref,paths,...args);
      const active = ledgersForProject(ref);
      if (active.length === 1) {
        const recorded = [];
        const shaped = asArray(result).map(item => {
          if (!item?.content) return item;
          const ids = recordElementText(active[0],item.content,`read:${item.path || 'batch'}`);
          if (!ids.length) return item;
          recorded.push(...ids);
          return { ...item, bricks_evidence_recorded:{ task_id:active[0].task_id, element_ids:ids } };
        });
        if (recorded.length) return shaped;
      }
      return result;
    };
  }

  if (original.exec) {
    api.exec = async (ref, command, opts = {}) => {
      const result = await original.exec(ref,command,opts);
      const ledger = ledgers.get(String(opts?.work_session_id || '')) || null;
      if (!ledger) return result;
      const recorded = recordWpCliEvidence(ledger,command,result);
      return (recorded.element_ids.length || recorded.media_ids.length)
        ? { ...result, bricks_evidence_recorded:{ task_id:ledger.task_id, ...recorded } }
        : result;
    };
  }

  api.completeTask = async (taskId, patch, verifyCommands, options = {}) => {
    const id = String(taskId || '');
    let ledger = ledgers.get(id) || null;
    const receipt = typeof api.bricksSkillReceipt === 'function' ? api.bricksSkillReceipt(id) : null;
    if (!ledger && receipt?.skill_id === WORDPRESS_BRICKS_SKILL_ID) {
      ledger = createLedger(receipt,'');
      ledgers.set(id,ledger);
    }
    if (!ledger) return original.completeTask(taskId,patch,verifyCommands,options);

    const patchLint = lintPatch(ledger,patch);
    const phpPreflight = await phpDuplicatePreflight(original,ledger.project_id || ledger.project_name,patch);
    const blocking = [...patchLint.errors, ...phpPreflight.errors];
    if (blocking.length) {
      throw chatError('BRICKS_EVIDENCE_REQUIRED','Bricks hardening preflight blocked the patch before mutation.',{
        task_id:id,
        errors:blocking,
        warnings:[...patchLint.warnings,...phpPreflight.warnings],
        evidence:ledgerSummary(ledger),
        next_action:'Read the current persisted Bricks tree or verify media through WP-CLI in this task, fix unstable selectors/duplicate PHP ownership, then call complete_task again with the same task_id.'
      });
    }

    const result = await original.completeTask(taskId,patch,verifyCommands,options);
    const verification = verificationState(result,ledger);
    const output = {
      ...result,
      bricks_evidence:ledgerSummary(ledger),
      bricks_patch_lint:{ ok:true, warnings:patchLint.warnings, refs:patchLint.refs },
      php_duplicate_preflight:phpPreflight,
      verification_state:verification,
      definition_of_done:{
        code:verification.code_verified ? 'verified' : 'not_verified',
        deploy:verification.deployment,
        live:verification.live,
        responsive:verification.responsive
      }
    };
    if (isTerminal(result?.status)) ledgers.delete(id);
    return output;
  };

  api.bricksEvidence = taskId => {
    const ledger = ledgers.get(String(taskId || ''));
    return ledger ? ledgerSummary(ledger) : null;
  };
  return api;
}

function installBricksEvidencePatches() {
  const safety = require('./safety-tools');
  if (safety.__bricksEvidencePatched) return;
  safety.__bricksEvidencePatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function bricksEvidenceSafeToolApi(projects, store, approvals, backups, options) {
    return createBricksEvidenceApi(previousCreate(projects,store,approvals,backups,options),store);
  };
}

module.exports = {
  HARDENING_VERSION,
  HARDENING_RULES,
  extractPersistedElementIds,
  extractPatchEvidenceRefs,
  phpDuplicatePreflight,
  lintPatch,
  verificationState,
  createBricksEvidenceApi,
  installBricksEvidencePatches
};
