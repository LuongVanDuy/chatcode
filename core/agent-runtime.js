const { normalizeError, chatError } = require('./errors');
const { skillsForTask } = require('./skill-runtime');
const { buildTaskCard } = require('./task-planner');

const MAX_VERIFY = 6;
const MAX_CONTEXT_FILES = 6;
const MAX_TASK_CARDS = 200;

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
  if (!store || typeof store.getProject !== 'function') return [];
  try { return (store.getProject(projectId).projectRules || []).map(item => ({ key:item.key, value:item.value })); }
  catch { return []; }
}

function saveProjectRules(store, projectId, input) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') return [];
  const proposed = Array.isArray(input) ? input : [];
  if (!proposed.length) return [];
  const state = store.read();
  const index = state.projects.findIndex(project => project.id === projectId);
  if (index < 0) return [];
  const now = new Date().toISOString();
  const merged = [...(state.projects[index].projectRules || []), ...proposed.map(item => ({ key:item?.key, value:item?.value, updatedAt:now }))];
  state.projects[index].projectRules = typeof store.normalizeProjectRules === 'function' ? store.normalizeProjectRules(merged) : merged;
  store.write(state);
  return readProjectRules(store, projectId);
}

async function verificationHints(api, projectId, inspect) {
  const hints = [];
  const isWordPress = !!inspect?.wordpress?.isWordPress;
  const packageWasRetrieved = (inspect?.relevant_files || []).some(item => String(item?.path || '').toLowerCase() === 'package.json');
  // Do not probe project-root package.json on ordinary WordPress work. Use it only when
  // the scoped inspection already established that package.json is relevant.
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

function compactInspection(inspect) {
  return {
    project:inspect.project,
    frameworks:inspect.frameworks,
    framework_names:inspect.framework_names,
    primary_language:inspect.primary_language,
    entrypoints:inspect.entrypoints,
    wordpress:inspect.wordpress,
    retrieval_scope:inspect.retrieval_scope || null,
    relevant_files:(inspect.relevant_files || []).slice(0, MAX_CONTEXT_FILES),
    relevant_relations:(inspect.relevant_relations || []).slice(0,80),
    top_symbols:(inspect.top_symbols || []).slice(0,60),
    git:inspect.git
  };
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
    const boundedLimit = Math.min(12, Math.max(4, Number(limit) || 8));

    const inspectStarted = nowMs();
    const [session, inspect] = await Promise.all([
      api.startWork(ref, text, { compactBaseline:true }),
      api.inspectProject(ref, text, boundedLimit)
    ]);
    const inspectMs = nowMs() - inspectStarted;
    const hints = await verificationHints(api, session.project_id, inspect);
    const skills = skillsForTask(inspect, text);
    const projectRules = readProjectRules(store, session.project_id);
    const taskCard = buildTaskCard({ request:text, inspect, projectRules, verificationHints:hints });
    rememberTaskCard(session.work_session_id, taskCard);

    return {
      ok:true,
      status:'ready',
      task_id:session.work_session_id,
      work_session_id:session.work_session_id,
      request:text,
      workspace_mode:session.workspace_mode,
      context:compactInspection(inspect),
      skills,
      project_rules:projectRules,
      task_card:taskCard,
      verification_hints:hints,
      agent_contract:{
        preferred_calls:2,
        current_call:1,
        next_tool:'complete_task',
        patch_format:'standard unified diff',
        guidance:[
          'Nếu response có skills, các rule/instructions/resource đính kèm là contract bắt buộc cho task hiện tại.',
          'Bám task_card: giữ đúng target, ưu tiên owner candidate hiện có, tôn trọng must_preserve/out_of_scope và không tự mở rộng task.',
          'Dùng context trong response này để lập patch; chỉ đọc thêm khi thiếu dữ kiện thật sự.',
          'Tôn trọng project_rules như quyết định bền vững đã được người dùng xác nhận; không trộn quy ước từ dự án hoặc theme khác.',
          'Với WordPress, tôn trọng context.retrieval_scope: search/Brain trước, đọc active child theme và plugin liên quan trước; chỉ mở rộng ra Bricks parent, Woo core hoặc WordPress core khi có evidence cụ thể.',
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
          task_card:taskCard,
          verification, verification_passed:false, changed_files:applied.changed_files || [], patch:applied,
          rollback:rolled,
          next_action:'Task đã rollback vì verification fail. Gọi prepare_task nếu muốn thử lại từ baseline.',
          telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:0, brain_refresh_ms:Number(applied?.brain?.refresh_ms)||0, git_ms:0 }
        };
      }
      const current = await api.workStatus(id);
      return {
        ok:false, status:'needs_fix', task_id:id, work_session_id:id,
        task_card:taskCard,
        verification, verification_passed:false,
        changed_files:current.changed_files || applied.changed_files || [],
        git:current.current?.git || applied.git || null,
        recovery_points:current.recovery_points || applied.recovery_points || [],
        next_action:'Giữ nguyên task_id và trạng thái hiện tại. Tạo corrective unified diff rồi gọi complete_task lại; chỉ rollback_work nếu muốn hủy toàn bộ task.',
        telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:0, brain_refresh_ms:Number(applied?.brain?.refresh_ms)||0, git_ms:0 }
      };
    }

    if (!finalize) {
      const current = await api.workStatus(id);
      return {
        ok:true, status:'ready_for_more', task_id:id, work_session_id:id,
        task_card:taskCard,
        verification, verification_passed:true,
        changed_files:current.changed_files || applied.changed_files || [], git:current.current?.git || applied.git || null,
        recovery_points:current.recovery_points || applied.recovery_points || [],
        next_action:'Task vẫn active. Có thể gọi complete_task thêm hoặc finish_work.',
        telemetry:{ total_ms:nowMs() - started, patch_ms:patchMs, verify_ms:verifyMs, finalize_ms:0, brain_refresh_ms:Number(applied?.brain?.refresh_ms)||0, git_ms:0 }
      };
    }

    const finalizeStarted = nowMs();
    const finished = await api.finishWork(id, [], { reuseFinal:{ brain:applied.brain || null, git:applied.git || null } });
    const finalizeMs = nowMs() - finalizeStarted;
    const projectRules = saveProjectRules(store, projectId, rememberProjectRules);
    taskCards.delete(id);
    return {
      ok:true, status:'completed', task_id:id, work_session_id:id,
      task_card:taskCard,
      verification, verification_passed:true,
      changed_files:finished.changed_files || applied.changed_files || [],
      recovery_points:finished.recovery_points || applied.recovery_points || [],
      git:finished.final?.git || applied.git || null,
      brain:finished.brain || applied.brain || null,
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

module.exports = { installAgentRuntimePatches, createAgentRuntime, verificationHints, inferredSyntaxCommands };
