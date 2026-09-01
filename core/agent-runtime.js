const { normalizeError, chatError } = require('./errors');
const { skillsForTask } = require('./skill-runtime');
const {
  readProjectProfile,
  refreshProjectProfile,
  saveProjectDecisions,
  projectProfileContext
} = require('./project-profile');
const {
  buildTaskCard,
  preflightExecutionPath,
  EXECUTION_PATHS,
  validatePatchAgainstTaskCard
} = require('./task-planner');

const MAX_VERIFY = 6;
const MAX_CONTEXT_FILES = 6;
const MAX_TASK_CARDS = 200;
const FAST_SKILL_CONTRACT = [
  'WordPress + Bricks Fast Path contract:',
  '- Keep the request targeted. Do not redesign, refactor broadly, seed/migrate data, or create parallel owners.',
  '- Prefer the existing Bricks-native owner and existing shared renderer/component before custom PHP/HTML or shortcode wrappers.',
  '- Normal editor-owned content must remain editable in Builder; preserve current Builder/user-edited data and unrelated element settings.',
  '- Global tokens stay in the established global CSS owner; page/component CSS owns only its scope.',
  '- Generic product wording does not imply WooCommerce when project evidence says CPT/non-Woo.',
  '- Use named external references only as scoped sources; do not broad-search unrelated sites.',
  '- Validate only the touched scope, run syntax checks for changed executable source, then stop.'
].join('\n');

function nowMs() { return Number(process.hrtime.bigint() / 1000000n); }

function unique(values) { return [...new Set((values || []).filter(Boolean))]; }

function inferredSyntaxCommands(files) {
  const commands = [];
  for (const item of Array.isArray(files) ? files : []) {
    if (String(item?.operation || '') === 'delete') continue;
    const file = String(item?.path || item || '').replace(/\\/g, '/');
    if (!file) continue;
    if (/\.php$/i.test(file)) commands.push(`php -l "${file}"`);
    else if (/\.(?:js|cjs|mjs)$/i.test(file)) commands.push(`node --check "${file}"`);
  }
  return unique(commands).slice(0, MAX_VERIFY);
}

function readProjectRules(store, projectId) {
  return (readProjectProfile(store, projectId).decisions || []).map(item => ({ key:item.key, value:item.value }));
}

function saveProjectRules(store, projectId, input) {
  return saveProjectDecisions(store, projectId, input);
}

function relevantProjectRules(allRules, taskCard) {
  const wanted = new Set((taskCard?.decision_keys || []).map(String));
  if (!wanted.size) return [];
  return (Array.isArray(allRules) ? allRules : []).filter(rule => wanted.has(String(rule?.key || ''))).slice(0,6);
}

async function verificationHints(api, projectId, inspect) {
  const hints = [];
  const isWordPress = !!inspect?.wordpress?.isWordPress;
  const packageWasRetrieved = (inspect?.relevant_files || []).some(item => String(item?.path || '').toLowerCase() === 'package.json');
  if (!isWordPress || packageWasRetrieved) {
    try {
      const pkg = await api.readFile(projectId, 'package.json');
      const parsed = JSON.parse(String(pkg.content || '{}'));
      const scripts = parsed && typeof parsed.scripts === 'object' ? parsed.scripts : {};
      for (const name of ['test','lint','typecheck','check','build']) {
        if (!scripts[name]) continue;
        hints.push({ kind:'package-script', command:`npm run ${name}`, evidence:`package.json#scripts.${name}` });
        if (hints.length >= 3) break;
      }
    } catch {}
  }

  const language = String(inspect?.primary_language || '').toLowerCase();
  const frameworks = (inspect?.framework_names || []).map(String);
  if (language.includes('php') || frameworks.some(x => /wordpress|woocommerce/i.test(x))) {
    hints.push({ kind:'changed-file-syntax', command_template:'php -l "{file}"', applies_to:['.php'], evidence:'PHP/WordPress project' });
  }
  if (language.includes('javascript') || language.includes('typescript') || frameworks.some(x => /node|react|vite|next/i.test(x))) {
    hints.push({ kind:'changed-file-syntax', command_template:'node --check "{file}"', applies_to:['.js','.cjs','.mjs'], evidence:'JavaScript/Node project' });
  }
  return hints.slice(0,5);
}

function compactInspection(inspect, maxFiles = MAX_CONTEXT_FILES) {
  const limit = Math.min(MAX_CONTEXT_FILES, Math.max(1, Number(maxFiles) || MAX_CONTEXT_FILES));
  return {
    project:inspect.project,
    frameworks:inspect.frameworks,
    framework_names:inspect.framework_names,
    primary_language:inspect.primary_language,
    entrypoints:inspect.entrypoints,
    wordpress:inspect.wordpress,
    retrieval_scope:inspect.retrieval_scope || null,
    relevant_files:(inspect.relevant_files || []).slice(0, limit),
    relevant_relations:(inspect.relevant_relations || []).slice(0, limit === 4 ? 32 : 80),
    top_symbols:(inspect.top_symbols || []).slice(0, limit === 4 ? 24 : 60),
    git:inspect.git
  };
}

function compactSkillsForFastPath(skills, charLimit = 6000) {
  const limit = Math.max(1000, Number(charLimit) || 6000);
  return (Array.isArray(skills) ? skills : []).map(skill => ({
    id:skill.id,
    name:skill.name,
    version:skill.version,
    activation:skill.activation,
    mandatory:skill.mandatory !== false,
    instructions:FAST_SKILL_CONTRACT.slice(0, limit),
    resources:[],
    resource_context:{
      selected:(skill?.resource_context?.selected || []).slice(0,4),
      fast_compact:true,
      soft_limit_chars:limit,
      used_chars:Math.min(limit, FAST_SKILL_CONTRACT.length),
      omitted_support_resources:(skill?.resource_context?.selected || []).slice(4)
    }
  }));
}

function createAgentRuntime(api, store = null) {
  const taskCards = new Map();

  function rememberTaskCard(taskId, taskCard) {
    taskCards.set(String(taskId), taskCard);
    while (taskCards.size > MAX_TASK_CARDS) taskCards.delete(taskCards.keys().next().value);
  }

  async function prepareTask(ref, request, limit = 8) {
    const started = nowMs();
    const text = String(request || '').trim();
    if (!text) throw chatError('INTERNAL_ERROR', 'Yêu cầu coding task đang trống.');
    const requestedLimit = Math.min(12, Math.max(4, Number(limit) || 8));
    const preflight = preflightExecutionPath(text);
    const inspectLimit = Math.min(requestedLimit, Number(preflight?.limits?.context_files) || MAX_CONTEXT_FILES);

    const inspectStarted = nowMs();
    const [session, inspect] = await Promise.all([
      api.startWork(ref, text, { compactBaseline:true }),
      api.inspectProject(ref, text, inspectLimit)
    ]);
    const inspectMs = nowMs() - inspectStarted;
    const hints = await verificationHints(api, session.project_id, inspect);
    const fullProjectProfile = refreshProjectProfile(store, session.project_id, inspect);
    const allProjectRules = (fullProjectProfile.decisions || []).map(item => ({ key:item.key, value:item.value }));
    const taskCard = buildTaskCard({ request:text, inspect, projectRules:allProjectRules, verificationHints:hints });
    rememberTaskCard(session.work_session_id, taskCard);

    const rawSkills = skillsForTask(inspect, text);
    const skills = taskCard.execution.path === EXECUTION_PATHS.FAST
      ? compactSkillsForFastPath(rawSkills, taskCard.execution.skill_context_limit_chars)
      : rawSkills;
    const projectRules = relevantProjectRules(allProjectRules, taskCard);
    const projectProfile = projectProfileContext(fullProjectProfile, text, taskCard.type, taskCard.decision_keys || []);
    const context = compactInspection(inspect, taskCard.execution.context_file_limit);
    const pathGuidance = taskCard.execution.path === EXECUTION_PATHS.FAST
      ? `FAST Path: tối đa ${taskCard.execution.context_file_limit} file context và ${taskCard.execution.patch_file_limit} file patch; không tự tạo/xóa file ngoài allowance của task_card.`
      : `DEEP Path chỉ bật vì: ${(taskCard.execution.reasons || []).join(', ') || 'explicit high-risk task'}. Vẫn phải giữ scope theo target và owner.`;

    return {
      ok:true,
      status:'ready',
      task_id:session.work_session_id,
      work_session_id:session.work_session_id,
      request:text,
      workspace_mode:session.workspace_mode,
      execution_path:taskCard.execution.path,
      context,
      skills,
      project_profile:projectProfile,
      project_decisions:projectRules,
      project_rules:projectRules,
      task_card:taskCard,
      verification_hints:hints,
      agent_contract:{
        preferred_calls:2,
        current_call:1,
        next_tool:'complete_task',
        patch_format:'standard unified diff',
        guidance:[
          'Nếu response có skills, các rule/instructions đính kèm là contract bắt buộc cho task hiện tại.',
          pathGuidance,
          'Bám task_card: giữ đúng target, ưu tiên owner candidate hiện có, tôn trọng must_preserve/out_of_scope và không tự mở rộng task.',
          'FAST không được tự chuyển thành DEEP trong complete_task. Nếu evidence mới làm task hiện tại không an toàn, dừng và re-plan thay vì patch rộng.',
          'Dùng context trong response này để lập patch; chỉ đọc thêm khi thiếu dependency cụ thể.',
          'Dùng project_profile.facts làm project facts hiện hành và project_profile.decisions cho các quyết định liên quan task; project_rules chỉ là alias tương thích.',
          'Với WordPress, tôn trọng context.retrieval_scope và chỉ mở rộng ra Bricks parent, Woo core hoặc WordPress core khi có evidence cụ thể.',
          'Gọi complete_task với task_id này, unified diff và các verify_commands phù hợp.',
          'Nếu complete_task trả needs_fix, sửa trên trạng thái hiện tại và gọi complete_task lại; không tạo session mới.',
          'Nếu cần hủy toàn bộ thay đổi của task, dùng rollback_work với cùng task_id.'
        ]
      },
      baseline:session.baseline,
      telemetry:{ total_ms:nowMs() - started, inspect_ms:inspectMs, filesystem_ms:Number(inspect?.telemetry?.filesystem_ms)||0, brain_refresh_ms:Number(inspect?.telemetry?.brain_refresh_ms)||0, git_ms:Number(inspect?.telemetry?.git_ms)||0 }
    };
  }

  async function runVerification(projectId, taskId, workspaceMode, commands, { preferTaskRunner = false } = {}) {
    const results = [];
    for (const command of commands.slice(0, MAX_VERIFY)) {
      const started = nowMs();
      try {
        let raw;
        if (!preferTaskRunner && workspaceMode === 'trusted' && typeof api.exec === 'function') {
          raw = await api.exec(projectId, command, { background:false, timeout_ms:120000, work_session_id:taskId });
          results.push({ command, ok:raw.status === 'completed' && Number(raw.exit_code) === 0, status:raw.status, exit_code:raw.exit_code, stdout:String(raw.stdout || '').slice(-16000), stderr:String(raw.stderr || '').slice(-16000), duration_ms:nowMs() - started });
        } else {
          raw = await api.runTask(projectId, command);
          results.push({ command, ok:!!raw.ok && Number(raw.code || 0) === 0, status:raw.ok ? 'completed' : 'failed', exit_code:Number(raw.code || 0), stdout:String(raw.stdout || '').slice(-16000), stderr:String(raw.stderr || '').slice(-16000), duration_ms:nowMs() - started });
        }
      } catch (error) {
        results.push({ command, ok:false, status:'failed', error:normalizeError(error), duration_ms:nowMs() - started });
      }
    }
    return results;
  }

  async function completeTask(taskId, patch, verifyCommands = [], { finalize = true, rollbackOnFailure = false, rememberProjectRules = [] } = {}) {
    const started = nowMs();
    const id = String(taskId || '').trim();
    if (!id) throw chatError('FILE_NOT_FOUND', 'task_id đang trống.');
    const taskCard = taskCards.get(id) || null;
    const before = typeof api.workMeta === 'function' ? await api.workMeta(id) : await api.workStatus(id);
    if (before.status !== 'active') throw chatError('PERMISSION_DENIED', 'Fast Agent task không còn active.', { task_id:id, status:before.status });
    const projectId = before.project_id;
    const requestedCommands = unique((Array.isArray(verifyCommands) ? verifyCommands : []).map(x => String(x || '').trim())).slice(0, MAX_VERIFY);
    const scopeCheck = validatePatchAgainstTaskCard(taskCard, String(patch || ''));
    if (!scopeCheck.ok) {
      throw chatError('TASK_SCOPE_VIOLATION', 'Patch vượt contract của FAST Path. Không có file nào được thay đổi.', {
        task_id:id,
        execution_path:taskCard?.execution?.path || null,
        target:taskCard?.target || null,
        violations:scopeCheck.violations,
        patch_files:scopeCheck.files,
        unexpected_files:scopeCheck.unexpected_files,
        next_action:'Giữ task hiện tại nếu có thể thu nhỏ patch. Nếu dependency mới thật sự yêu cầu scope rộng hơn, re-plan bằng prepare_task thay vì tự chuyển FAST thành DEEP.'
      });
    }

    const patchStarted = nowMs();
    const applied = await api.applyPatch(projectId, String(patch || ''), id);
    const patchMs = nowMs() - patchStarted;
    const commands = requestedCommands.length ? requestedCommands : inferredSyntaxCommands(applied.files || applied.changed_files || []);

    const verifyStarted = nowMs();
    const verification = await runVerification(projectId, id, before.workspace_mode, commands, { preferTaskRunner:requestedCommands.length === 0 });
    const verifyMs = nowMs() - verifyStarted;
    const verificationPassed = verification.every(item => item.ok);

    if (!verificationPassed) {
      if (rollbackOnFailure) {
        const rolled = await api.rollbackWork(id);
        taskCards.delete(id);
        return {
          ok:false, status:'rolled_back', task_id:id, work_session_id:id,
          execution_path:taskCard?.execution?.path || null,
          task_card:taskCard, scope_check:scopeCheck,
          verification, verification_passed:false, changed_files:applied.changed_files || [], patch:applied,
          rollback:rolled,
          next_action:'Task đã rollback vì verification fail. Gọi prepare_task nếu muốn thử lại từ baseline.',
          telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:0, brain_refresh_ms:Number(applied?.brain?.refresh_ms)||0, git_ms:0 }
        };
      }
      const current = await api.workStatus(id);
      return {
        ok:false, status:'needs_fix', task_id:id, work_session_id:id,
        execution_path:taskCard?.execution?.path || null,
        task_card:taskCard, scope_check:scopeCheck,
        verification, verification_passed:false,
        changed_files:current.changed_files || applied.changed_files || [],
        git:current.current?.git || applied.git || null,
        recovery_points:current.recovery_points || applied.recovery_points || [],
        next_action:'Giữ nguyên task_id và execution path. Tạo corrective unified diff nhỏ trong cùng scope rồi gọi complete_task lại; chỉ rollback_work nếu muốn hủy toàn bộ task.',
        telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:0, brain_refresh_ms:Number(applied?.brain?.refresh_ms)||0, git_ms:0 }
      };
    }

    if (!finalize) {
      const current = await api.workStatus(id);
      return {
        ok:true, status:'ready_for_more', task_id:id, work_session_id:id,
        execution_path:taskCard?.execution?.path || null,
        task_card:taskCard, scope_check:scopeCheck,
        verification, verification_passed:true,
        changed_files:current.changed_files || applied.changed_files || [], git:current.current?.git || applied.git || null,
        recovery_points:current.recovery_points || applied.recovery_points || [],
        next_action:'Task vẫn active và giữ nguyên execution path. Có thể gọi complete_task thêm hoặc finish_work.',
        telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:0, brain_refresh_ms:Number(applied?.brain?.refresh_ms)||0, git_ms:0 }
      };
    }

    const finalizeStarted = nowMs();
    const finished = await api.finishWork(id, [], { reuseFinal:{ brain:applied.brain || null, git:applied.git || null } });
    const finalizeMs = nowMs() - finalizeStarted;
    const savedProfile = saveProjectRules(store, projectId, rememberProjectRules);
    const savedRules = (savedProfile.decisions || []).map(item => ({ key:item.key, value:item.value }));
    const projectRules = relevantProjectRules(savedRules, taskCard);
    const profileContext = projectProfileContext(savedProfile, taskCard?.target || '', taskCard?.type || '', taskCard?.decision_keys || []);
    taskCards.delete(id);
    return {
      ok:true, status:'completed', task_id:id, work_session_id:id,
      execution_path:taskCard?.execution?.path || null,
      task_card:taskCard, scope_check:scopeCheck,
      verification, verification_passed:true,
      changed_files:finished.changed_files || applied.changed_files || [],
      recovery_points:finished.recovery_points || applied.recovery_points || [],
      git:finished.final?.git || applied.git || null,
      brain:finished.brain || applied.brain || null,
      project_profile:profileContext,
      project_decisions:projectRules,
      project_rules:projectRules,
      session:finished,
      agent_contract:{ preferred_calls:2, completed_in_call:2, result:'done' },
      telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:finalizeMs, brain_refresh_ms:Number(finished?.brain?.refresh_ms || applied?.brain?.refresh_ms)||0, git_ms:0 }
    };
  }

  return { prepareTask, completeTask };
}

function installAgentRuntimePatches() {
  const safety = require('./safety-tools');
  if (safety.__agentRuntimePatched) return;
  safety.__agentRuntimePatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function agentAwareSafeToolApi(projects, store, approvals, backups, options) {
    const api = previousCreate(projects, store, approvals, backups, options);
    const runtime = createAgentRuntime(api, store);
    api.prepareTask = (ref, request, limit) => runtime.prepareTask(ref, request, limit);
    api.completeTask = (taskId, patch, verifyCommands, options = {}) => runtime.completeTask(taskId, patch, verifyCommands, options);
    return api;
  };
}

module.exports = {
  installAgentRuntimePatches,
  createAgentRuntime,
  verificationHints,
  inferredSyntaxCommands,
  compactSkillsForFastPath
};
