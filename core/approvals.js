const crypto = require('crypto');
const { chatError } = require('./errors');

const LABELS = {
  write: 'Ghi file',
  rename: 'Đổi tên / di chuyển file',
  delete: 'Xóa file',
  task: 'Chạy tác vụ',
  gitStage: 'Git stage',
  gitCommit: 'Git commit'
};

function createApprovalService(store, { onChanged, onAttention } = {}) {
  const pending = new Map();
  const completed = new Map();
  const sessionAllow = new Set();
  const key = (projectId, action) => `${projectId}:${action}`;
  const approvalShape = (required, status, id = null, mode = null) => ({ required:!!required, status, approval_id:id, ...(mode ? { mode } : {}) });

  function remember(id, value) {
    if (!id) return;
    completed.set(id, { ...value, completedAt:new Date().toISOString() });
    setTimeout(() => completed.delete(id), 10 * 60 * 1000).unref?.();
  }

  function publicItem(item) {
    return {
      id:item.id,
      createdAt:item.createdAt,
      expiresAt:item.expiresAt,
      projectId:item.projectId,
      project:item.project,
      action:item.action,
      actionLabel:LABELS[item.action] || item.action,
      target:item.target,
      detail:item.detail,
      approval:approvalShape(true, 'pending', item.id)
    };
  }
  function list() { return [...pending.values()].map(publicItem).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  function emit() { onChanged?.(list()); }

  function updatePersistentRule(projectId, action, value) {
    const state = store.read(); const index = state.projects.findIndex(project => project.id === projectId); if (index < 0) return;
    state.projects[index].safety = store.normalizeSafety({ ...state.projects[index].safety, [action]:value }); store.write(state);
  }

  function requestDeferred(projectRef, action, details = {}) {
    const project = store.getProject(projectRef); const policy = store.normalizeSafety(project.safety)[action] || 'ask';
    if (policy === 'allow' || sessionAllow.has(key(project.id, action))) {
      const approval = approvalShape(false, 'not_required', null, policy === 'allow' ? 'rule' : 'session');
      return { approval, promise:Promise.resolve(approval) };
    }
    if (policy === 'deny') {
      const approval = approvalShape(true, 'denied', null, 'rule');
      const error = chatError('APPROVAL_REQUIRED', `Safety rule đang chặn thao tác: ${LABELS[action] || action}.`, { approval, action, project:project.name });
      return { approval, promise:Promise.reject(error) };
    }

    const timeoutSec = store.settings().approvalTimeoutSec; const id = crypto.randomUUID(); const createdAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();
    let resolvePromise, rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const timer = setTimeout(() => {
      pending.delete(id); const approval = approvalShape(true, 'denied', id, 'timeout'); remember(id, approval); emit();
      rejectPromise(chatError('APPROVAL_REQUIRED', `Yêu cầu xác nhận đã hết hạn sau ${timeoutSec} giây.`, { approval, action, project:project.name }));
    }, timeoutSec * 1000);
    const item = { id, createdAt, expiresAt, projectId:project.id, project:project.name, action, target:String(details.target || '').slice(0, 300), detail:String(details.detail || '').slice(0, 800), timer, resolve:resolvePromise, reject:rejectPromise };
    pending.set(id, item); emit(); onAttention?.(publicItem(item));
    return { approval:approvalShape(true, 'pending', id), promise };
  }

  async function request(projectRef, action, details = {}) { const deferred = requestDeferred(projectRef, action, details); return deferred.promise; }

  function respond(id, decision) {
    const item = pending.get(String(id)); if (!item) throw chatError('APPROVAL_REQUIRED', 'Yêu cầu xác nhận không còn tồn tại hoặc đã hết hạn.', { approval_id:String(id), status:'expired' });
    if (!['allow-once','allow-session','allow-always','deny'].includes(decision)) throw chatError('APPROVAL_REQUIRED','Quyết định xác nhận không hợp lệ.',{ approval_id:item.id, decision });
    clearTimeout(item.timer); pending.delete(item.id);
    if (decision === 'allow-session') sessionAllow.add(key(item.projectId, item.action));
    if (decision === 'allow-always') updatePersistentRule(item.projectId, item.action, 'allow');
    if (decision === 'deny') {
      const approval = approvalShape(true, 'denied', item.id, decision); remember(item.id, approval);
      item.reject(chatError('APPROVAL_REQUIRED','Người dùng đã từ chối thao tác trong Approval Center.',{ approval, action:item.action, project:item.project }));
    } else {
      const approval = approvalShape(true, 'approved', item.id, decision); remember(item.id, approval); item.resolve(approval);
    }
    emit(); return true;
  }

  function status(id) {
    const item = pending.get(String(id)); if (item) return publicItem(item).approval;
    return completed.get(String(id)) || null;
  }
  function clearSession() { sessionAllow.clear(); return true; }
  function shutdown() {
    for (const item of pending.values()) { clearTimeout(item.timer); const approval = approvalShape(true, 'denied', item.id, 'shutdown'); remember(item.id, approval); item.reject(chatError('APPROVAL_REQUIRED','ChatCode đang thoát nên yêu cầu xác nhận đã bị hủy.',{ approval })); }
    pending.clear(); emit();
  }

  return { request, requestDeferred, list, respond, status, clearSession, shutdown, labels:LABELS };
}

module.exports = { createApprovalService };