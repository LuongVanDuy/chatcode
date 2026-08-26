class ChatCodeError extends Error {
  constructor(code, message, details = undefined) {
    super(String(message || code || 'ChatCode error'));
    this.name = 'ChatCodeError';
    this.code = String(code || 'INTERNAL_ERROR');
    if (details !== undefined) this.details = details;
  }
}

function chatError(code, message, details) {
  return new ChatCodeError(code, message, details);
}

function throwCode(code, message, details) {
  throw chatError(code, message, details);
}

function normalizeError(error) {
  if (error instanceof ChatCodeError) {
    return { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) };
  }

  const rawCode = String(error?.code || '');
  const message = String(error?.message || error || 'Unknown error');
  const lower = message.toLowerCase();

  if (rawCode === 'ENOENT' || /enoent|không tồn tại|không tìm thấy|not found/.test(lower)) return { code: 'FILE_NOT_FOUND', message };
  if (/ngoài phạm vi|outside.*project|path.*outside/.test(lower)) return { code: 'PATH_OUTSIDE_PROJECT', message };
  if (/symlink|junction/.test(lower) && /chặn|blocked|outside|ngoài/.test(lower)) return { code: 'PATH_OUTSIDE_PROJECT', message };
  if (/nhạy cảm|sensitive/.test(lower)) return { code: 'SENSITIVE_PATH_BLOCKED', message };
  if (/quyền|permission/.test(lower)) return { code: 'PERMISSION_DENIED', message };
  if (/binary|định dạng.*không hỗ trợ|unsupported.*format/.test(lower)) return { code: 'UNSUPPORTED_BINARY', message };
  if (/danh sách tác vụ an toàn|task.*allow|lệnh.*không.*an toàn/.test(lower)) return { code: 'TASK_NOT_ALLOWED', message };
  if (/xác nhận|approval/.test(lower) && /chờ|pending|hết hạn|từ chối|deny|denied/.test(lower)) return { code: 'APPROVAL_REQUIRED', message };
  if (/not a git repository|không.*git repository/.test(lower)) return { code: 'GIT_NOT_REPOSITORY', message };
  if (/shell operator|shell chaining|toán tử shell/.test(lower)) return { code: 'TASK_NOT_ALLOWED', message };
  return { code: 'INTERNAL_ERROR', message };
}

module.exports = { ChatCodeError, chatError, throwCode, normalizeError };