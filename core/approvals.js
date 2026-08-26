const crypto = require('crypto');

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
  const sessionAllow = new Set();

  function key(projectId, action) { return `${projectId}:${action}`; }
  function publicItem(item) {
    return {
      id: item.id,
      createdAt: item.createdAt,
      expiresAt: item.expiresAt,
      projectId: item.projectId,
      project: item.project,
      action: item.action,
      actionLabel: LABELS[item.action] || item.action,
      target: item.target,
      detail: item.detail
    };
  }
  function list() { return [...pending.values()].map(publicItem).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  function emit() { onChanged?.(list()); }

  function updatePersistentRule(projectId, action, value) {
    const state = store.read();
    const index = state.projects.findIndex(project => project.id === projectId);
    if (index < 0) return;
    state.projects[index].safety = store.normalizeSafety({ ...state.projects[index].safety, [action]: value });
    store.write(state);
  }

  async function request(projectRef, action, details = {}) {
    const project = store.getProject(projectRef);
    const policy = store.normalizeSafety(project.safety)[action] || 'ask';
    if (policy === 'allow' || sessionAllow.has(key(project.id, action))) return { approved: true, mode: policy === 'allow' ? 'rule' : 'session' };
    if (policy === 'deny') throw new Error(`Safety rule đang chặn thao tác: ${LABELS[action] || action}.`);

    const timeoutSec = store.settings().approvalTimeoutSec;
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + timeoutSec * 1000).toISOString();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        emit();
        reject(new Error(`Yêu cầu xác nhận đã hết hạn sau ${timeoutSec} giây.`));
      }, timeoutSec * 1000);
      const item = {
        id, createdAt, expiresAt,
        projectId: project.id,
        project: project.name,
        action,
        target: String(details.target || '').slice(0, 300),
        detail: String(details.detail || '').slice(0, 800),
        timer, resolve, reject
      };
      pending.set(id, item);
      emit();
      onAttention?.(publicItem(item));
    });
  }

  function respond(id, decision) {
    const item = pending.get(String(id));
    if (!item) throw new Error('Yêu cầu xác nhận không còn tồn tại hoặc đã hết hạn.');
    if (!['allow-once', 'allow-session', 'allow-always', 'deny'].includes(decision)) throw new Error('Quyết định xác nhận không hợp lệ.');
    clearTimeout(item.timer);
    pending.delete(item.id);

    if (decision === 'allow-session') sessionAllow.add(key(item.projectId, item.action));
    if (decision === 'allow-always') updatePersistentRule(item.projectId, item.action, 'allow');

    if (decision === 'deny') item.reject(new Error('Người dùng đã từ chối thao tác trong Approval Center.'));
    else item.resolve({ approved: true, mode: decision });
    emit();
    return true;
  }

  function clearSession() {
    sessionAllow.clear();
    return true;
  }

  function shutdown() {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new Error('ChatCode đang thoát nên yêu cầu xác nhận đã bị hủy.'));
    }
    pending.clear();
    emit();
  }

  return { request, list, respond, clearSession, shutdown, labels: LABELS };
}

module.exports = { createApprovalService };
