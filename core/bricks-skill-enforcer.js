const crypto = require('crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { chatError } = require('./errors');
const { WORDPRESS_BRICKS_SKILL_ID, hasBricksProjectEvidence } = require('./skill-runtime');
const { resolveBricksSpec } = require('./bricks-spec');
const { isBuiltinRef } = require('./builtin-skills-project');

const CONTRACT_VERSION = 6;
const ACK_TEXT = 'Tôi sẽ sử dụng Bricks skill.';
const RECEIPT_TTL_MS = 6 * 60 * 60 * 1000;
const DETECTION_TTL_MS = 60 * 1000;

const HARD_RULES = [
  `Bricks mandatory contract v${CONTRACT_VERSION}:`,
  `- Khi nhận diện project Bricks, phải nói với người dùng đúng câu: "${ACK_TEXT}"`,
  '- Mỗi coding task phải đi qua prepare_task trên đúng project; inspect/read không mở khóa quyền mutation cho task khác.',
  '- Bricks element ID là evidence theo task: đọc persisted Bricks tree hiện tại trước khi dùng ID cho CSS/selector/query target/migration; không dùng ID từ chat cũ, clone, frontend export hay project khác.',
  '- WordPress media/attachment ID là site-local evidence: verify trực tiếp trên project hiện tại trong cùng task; không suy từ URL/file name và không reuse ID của task/project khác.',
  '- Ưu tiên semantic class/global class do project kiểm soát; tránh selector phụ thuộc #brxe-*, generated ID hoặc [data-field-id] trừ khi ID/DOM đã được verify và task thực sự cần.',
  '- functions.php chỉ bootstrap/require/enqueue cho feature mới; sửa nhỏ owner đã tồn tại được phép, nhưng không nhét feature mới/large inline JS/migration vào đó.',
  '- Xác định PHP/CSS owner trước khi sửa; global token ở global owner, page/component CSS ở owner của page/component; không append override vô hạn vào style.css.',
  '- UI editable phải nằm trong Bricks tree/controls khi yêu cầu Builder-editable; frontend đúng nhưng Builder không chỉnh được là chưa đạt.',
  '- UI task phải kiểm desktop/tablet/mobile. Ghi/upload thành công không đồng nghĩa task thành công; chỉ claim visual/live PASS khi frontend live đã được verify, nếu không phải nói rõ giới hạn.'
].join('\n');

function normalizeRef(value) { return String(value || '').trim().toLowerCase(); }
function terminalStatus(value) { return /^(?:completed|finished|rolled_back|cancelled|canceled|failed|deploy_failed)$/i.test(String(value || '')); }

function receiptRootFingerprint(project = {}) {
  return crypto.createHash('sha256').update(String(project?.root || '')).digest('hex').slice(0,16);
}

function skillFrom(result) {
  return (Array.isArray(result?.skills) ? result.skills : []).find(skill => skill?.id === WORDPRESS_BRICKS_SKILL_ID) || null;
}

function hardenSkill(skill) {
  if (!skill || skill.id !== WORDPRESS_BRICKS_SKILL_ID) return skill;
  const existing = String(skill.instructions || '').trim();
  const instructions = `${HARD_RULES}\n\n${existing}`.trim();
  const skillPackageVersion = Number(skill?.version || 0);
  return {
    ...skill,
    skill_package_version:skillPackageVersion,
    contract_version:CONTRACT_VERSION,
    enforcement:'task-bound',
    user_acknowledgement_required:ACK_TEXT,
    instructions,
    resource_context:{ ...(skill.resource_context || {}), mandatory_contract_version:CONTRACT_VERSION, hard_rules_chars:HARD_RULES.length }
  };
}

function policyShape(receipt = null, attached = true) {
  return {
    mandatory:true,
    skill_id:WORDPRESS_BRICKS_SKILL_ID,
    contract_version:CONTRACT_VERSION,
    enforcement:'task-bound',
    modern_workflow:'prepare_task -> complete_task',
    inspect_authorizes_mutation:false,
    low_level_mutation_without_task:'blocked',
    attached:!!attached,
    acknowledgement_required:true,
    acknowledgement_text:ACK_TEXT,
    ...(receipt ? { receipt } : {})
  };
}

function createBricksSkillEnforcerApi(api, store) {
  if (!api || api.__bricksSkillEnforcerWrapped || typeof api.inspectProject !== 'function') return api;
  api.__bricksSkillEnforcerWrapped = true;

  const names = [
    'inspectProject','prepareTask','completeTask','startWork','applyPatch','applyAndVerify','finishWork','rollbackWork','workStatus',
    'writeFile','deleteFile','renameFile','runTask','exec','databaseOp'
  ];
  const original = {};
  for (const name of names) if (typeof api[name] === 'function') original[name] = api[name].bind(api);
  const modern = !!original.prepareTask && !!original.completeTask;
  const receipts = new Map();
  const detection = new Map();
  const internalScope = new AsyncLocalStorage();

  function now() { return Date.now(); }
  function prune() {
    const cutoff = now() - RECEIPT_TTL_MS;
    for (const [id,item] of receipts) if ((item?.at || 0) < cutoff) receipts.delete(id);
  }
  function project(ref) {
    if (!store?.getProject) return { id:String(ref || ''), name:String(ref || ''), root:'' };
    return store.getProject(ref);
  }
  function projectMatches(receipt, ref) {
    let p;
    try { p = project(ref); } catch { return false; }
    return !!receipt && [receipt.project_id,receipt.project_name].map(normalizeRef).includes(normalizeRef(p.id))
      || !!receipt && [receipt.project_id,receipt.project_name].map(normalizeRef).includes(normalizeRef(p.name));
  }
  function bootstrapContext(ref) {
    const p = project(ref);
    return {
      mode:'prepare',
      project_id:String(p.id || ''),
      project_name:String(p.name || ''),
      project_root_fingerprint:receiptRootFingerprint(p),
      start_work_used:false
    };
  }
  function bootstrapMatches(context, ref) {
    if (!context || context.mode !== 'prepare' || !projectMatches(context,ref)) return false;
    let p;
    try { p = project(ref); } catch { return false; }
    return !context.project_root_fingerprint || context.project_root_fingerprint === receiptRootFingerprint(p);
  }
  function isInternalComplete() {
    return internalScope.getStore()?.mode === 'complete';
  }
  async function detect(ref) {
    if (isBuiltinRef(ref)) return { active:false, inspect:null };
    const key = normalizeRef(ref);
    const cached = detection.get(key);
    if (cached && now() - cached.at < DETECTION_TTL_MS) return cached.value;
    const inspect = await original.inspectProject(ref, 'Detect WordPress + Bricks mandatory task-bound skill policy from current project evidence', 4);
    const evidence = hasBricksProjectEvidence(inspect);
    const value = { active:!!evidence.active, inspect };
    detection.set(key,{ at:now(), value });
    const p = inspect?.project || {};
    for (const alias of [p.id,p.name].map(normalizeRef).filter(Boolean)) detection.set(alias,{ at:now(), value });
    return value;
  }
  function required(ref, operation, details = {}) {
    throw chatError('BRICKS_SKILL_TASK_REQUIRED', 'Project Bricks bắt buộc chạy wordpress-bricks skill theo đúng task trước khi mutation.', {
      project:String(ref || ''), operation, skill_id:WORDPRESS_BRICKS_SKILL_ID, contract_version:CONTRACT_VERSION,
      acknowledgement:ACK_TEXT,
      required_workflow:'prepare_task(project, request) -> complete_task(task_id, patch, verify_commands)',
      rule:'inspect_project/read_file không cấp quyền mutation. Mỗi task Bricks cần task_id/skill receipt riêng.',
      ...details
    });
  }
  function receiptValid(id, ref = '') {
    prune();
    const receipt = receipts.get(String(id || '')) || null;
    if (!receipt) return null;
    if (ref && !projectMatches(receipt, ref)) return null;
    let p;
    try { p = project(receipt.project_id || receipt.project_name); } catch { return null; }
    if (receipt.project_root_fingerprint && receipt.project_root_fingerprint !== receiptRootFingerprint(p)) return null;
    return receipt;
  }
  function makeReceipt(ref, result, skill, inspect = null) {
    const p = project(ref);
    const taskId = String(result?.task_id || result?.work_session_id || '');
    const spec = skill?.bricks_spec || {};
    const fallbackSpec = inspect ? resolveBricksSpec(inspect) : null;
    const skillPackageVersion = Number(skill?.version || skill?.skill_package_version || 0);
    const profileVersion = result?.project_profile?.facts?.bricks_version || result?.context?.project_profile?.facts?.bricks_version || null;
    return {
      task_id:taskId,
      project_id:String(p.id || ''),
      project_name:String(p.name || ''),
      project_root_fingerprint:receiptRootFingerprint(p),
      skill_id:WORDPRESS_BRICKS_SKILL_ID,
      skill_package_version:skillPackageVersion,
      skill_version:skillPackageVersion,
      contract_version:CONTRACT_VERSION,
      domains:(skill?.domains || []).slice(0,2),
      bricks_detected_version:spec.detected_version || skill?.bricks_detected_version || profileVersion || fallbackSpec?.detected_version || null,
      bricks_spec_version:spec.spec_version || skill?.bricks_spec_version || fallbackSpec?.spec_version || null,
      bricks_spec_status:spec.status || skill?.bricks_spec_status || fallbackSpec?.status || null,
      execution_path:result?.execution_path || result?.task_card?.execution?.path || null,
      prepared_at:new Date().toISOString()
    };
  }

  api.inspectProject = async (ref, query, limit) => {
    const result = await original.inspectProject(ref, query, limit);
    const evidence = hasBricksProjectEvidence(result);
    if (!evidence.active) return result;
    const skills = (Array.isArray(result.skills) ? result.skills : []).map(hardenSkill);
    const attached = skills.some(skill => skill?.id === WORDPRESS_BRICKS_SKILL_ID && skill?.mandatory !== false);
    return {
      ...result,
      skills,
      skill_policy:policyShape(null,attached),
      user_acknowledgement_required:ACK_TEXT,
      next_action:'Coding task trên project này phải gọi prepare_task. inspect_project chỉ đọc/nhận diện và không mở khóa mutation.'
    };
  };

  if (original.prepareTask) {
    api.prepareTask = async (ref, request, limit, options) => {
      return internalScope.run(bootstrapContext(ref), async () => {
        const result = await original.prepareTask(ref, request, limit, options);
        const evidence = hasBricksProjectEvidence(result?.context || {});
        if (!evidence.active) return result;
        const skills = (Array.isArray(result.skills) ? result.skills : []).map(hardenSkill);
        const skill = skills.find(item => item?.id === WORDPRESS_BRICKS_SKILL_ID && item?.mandatory !== false);
        if (!skill) required(ref,'prepare_task',{ reason:'wordpress-bricks skill was not attached' });
        let versionInspect = null;
        if (!skill?.bricks_detected_version && !skill?.bricks_spec?.detected_version && !result?.project_profile?.facts?.bricks_version) {
          try { versionInspect = (await detect(ref))?.inspect || null; } catch {}
        }
        const receipt = makeReceipt(ref,result,skill,versionInspect);
        if (!receipt.task_id) required(ref,'prepare_task',{ reason:'task_id missing after preparation' });
        receipts.set(receipt.task_id,{ ...receipt, at:now() });
        const guidance = Array.isArray(result?.agent_contract?.guidance) ? result.agent_contract.guidance : [];
        return {
          ...result,
          skills,
          skill_receipt:receipt,
          skill_policy:policyShape(receipt,true),
          user_acknowledgement_required:ACK_TEXT,
          agent_contract:{
            ...(result.agent_contract || {}),
            guidance:[
              `Bắt buộc nói với người dùng: "${ACK_TEXT}"`,
              'Skill receipt chỉ hợp lệ cho task_id/project/root/domains hiện tại; task khác phải prepare lại.',
              ...guidance
            ]
          }
        };
      });
    };
  }

  if (original.completeTask) {
    api.completeTask = async (taskId, ...args) => {
      prune();
      const id = String(taskId || '');
      const receipt = receiptValid(id);
      if (!receipt && original.workStatus) {
        let status = null;
        try { status = await original.workStatus(id); } catch {}
        const ref = status?.project_id || status?.project || '';
        if (ref) {
          const policy = await detect(ref);
          if (policy.active) required(ref,'complete_task',{ task_id:id, reason:'no valid task-bound skill receipt' });
        }
      }
      const result = await internalScope.run({ mode:'complete', task_id:id }, () => original.completeTask(taskId,...args));
      if (receipt) {
        const clean = { ...receipt }; delete clean.at;
        result.skill_receipt = clean;
        result.skill_policy = policyShape(clean,true);
      }
      if (terminalStatus(result?.status)) receipts.delete(id);
      return result;
    };
  }

  if (original.startWork) {
    api.startWork = async (ref, ...args) => {
      const scoped = internalScope.getStore();
      if (isInternalComplete() || !modern) return original.startWork(ref,...args);
      if (bootstrapMatches(scoped,ref)) {
        if (scoped.start_work_used) required(ref,'start_work',{ reason:'prepare_task bootstrap may create only one Work Session' });
        scoped.start_work_used = true;
        return original.startWork(ref,...args);
      }
      const policy = await detect(ref);
      if (policy.active) required(ref,'start_work',{ reason:'use prepare_task so the skill/domain contract is attached before the Work Session starts' });
      return original.startWork(ref,...args);
    };
  }

  if (original.applyPatch) {
    api.applyPatch = async (ref, patch, sessionId = '', ...rest) => {
      if (isInternalComplete() || !modern) return original.applyPatch(ref,patch,sessionId,...rest);
      const policy = await detect(ref);
      if (policy.active && !receiptValid(sessionId,ref)) required(ref,'apply_patch',{ task_id:String(sessionId || ''), reason:'patch is not bound to a prepared Bricks task' });
      return original.applyPatch(ref,patch,sessionId,...rest);
    };
  }

  if (original.applyAndVerify) {
    api.applyAndVerify = async (ref, ...args) => {
      if (isInternalComplete() || !modern) return original.applyAndVerify(ref,...args);
      const policy = await detect(ref);
      if (policy.active) required(ref,'apply_and_verify',{ reason:'compatibility fast path has no task receipt; use prepare_task -> complete_task' });
      return original.applyAndVerify(ref,...args);
    };
  }

  for (const name of ['writeFile','deleteFile','renameFile','runTask']) {
    if (!original[name]) continue;
    api[name] = async (ref, ...args) => {
      if (isInternalComplete() || !modern) return original[name](ref,...args);
      const policy = await detect(ref);
      if (policy.active) required(ref,name,{ reason:'low-level operation has no task_id/skill receipt' });
      return original[name](ref,...args);
    };
  }


if (original.databaseOp) {
  api.databaseOp = async (ref, input = {}) => {
    const action = String(input?.action || 'inspect').trim().toLowerCase();
    if (isInternalComplete() || !modern || action === 'inspect' || action === 'rollback') return original.databaseOp(ref,input);
    const policy = await detect(ref);
    if (policy.active) {
      const taskId = String(input?.task_id || '');
      if (!receiptValid(taskId,ref)) required(ref,`database_${action}`,{
        task_id:taskId,
        reason:'database query/mutation on Bricks must be bound to the current prepared task receipt'
      });
    }
    return original.databaseOp(ref,input);
  };
}

  if (original.exec) {
    api.exec = async (ref, command, opts = {}) => {
      if (isInternalComplete() || !modern) return original.exec(ref,command,opts);
      const policy = await detect(ref);
      if (policy.active) {
        const sessionId = String(opts?.work_session_id || '');
        if (!receiptValid(sessionId,ref)) required(ref,'exec',{ task_id:sessionId, reason:'Trusted Terminal on Bricks must be bound to the current prepared task via work_session_id' });
      }
      return original.exec(ref,command,opts);
    };
  }

  if (original.finishWork) {
    api.finishWork = async (taskId, ...args) => {
      const id = String(taskId || '');
      const receipt = receiptValid(id);
      const cancel = args?.[1]?.cancel === true || args?.[0]?.cancel === true;
      if (!receipt && modern && original.workStatus && !cancel) {
        let status = null;
        try { status = await original.workStatus(id); } catch {}
        const ref = status?.project_id || status?.project || '';
        if (ref && (await detect(ref)).active) required(ref,'finish_work',{ task_id:id, reason:'session was not prepared with the Bricks skill' });
      }
      const result = await original.finishWork(taskId,...args);
      if (terminalStatus(result?.status) || cancel) receipts.delete(id);
      return result;
    };
  }

  if (original.rollbackWork) {
    api.rollbackWork = async (taskId, ...args) => {
      const id = String(taskId || '');
      const result = await original.rollbackWork(taskId,...args);
      receipts.delete(id);
      return result;
    };
  }

  api.bricksSkillReceipt = taskId => {
    const value = receiptValid(taskId);
    if (!value) return null;
    const clean = { ...value }; delete clean.at; return clean;
  };

  return api;
}

function installBricksSkillEnforcerPatches() {
  const safety = require('./safety-tools');
  if (safety.__bricksSkillEnforcerPatched) return;
  safety.__bricksSkillEnforcerPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function bricksSkillEnforcerSafeToolApi(projects, store, approvals, backups, options) {
    return createBricksSkillEnforcerApi(previousCreate(projects,store,approvals,backups,options),store);
  };
}

module.exports = {
  CONTRACT_VERSION,
  ACK_TEXT,
  HARD_RULES,
  receiptRootFingerprint,
  hardenSkill,
  policyShape,
  createBricksSkillEnforcerApi,
  installBricksSkillEnforcerPatches
};
