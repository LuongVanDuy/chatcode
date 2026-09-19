'use strict';

// Losing an HTTP acknowledgement does not roll back a PHP install. Reconcile
// through the existing authenticated verify action; never replay install here.
const UNCERTAIN_CODES = new Set([
  'BOOTSTRAP_HTTP_FAILED', 'BOOTSTRAP_RESPONSE_INVALID',
  'BOOTSTRAP_GATEWAY_FAILED', 'INSTALL_RESULT_UNCONFIRMED'
]);
const VERIFY_FAILURES = new Set([
  'TOKEN_INVALID', 'VERIFY_PLUGIN_FAILED', 'VERIFY_THEME_FAILED',
  'VERIFY_SITE_URL_FAILED', 'VERIFY_RESULT_INVALID', 'VERIFY_LANGUAGE_FAILED', 'VERIFY_PROFILE_FAILED'
]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function redactor(token, payload) {
  const values = [token];
  const collect = object => {
    if (!object || typeof object !== 'object') return;
    for (const [key, value] of Object.entries(object)) {
      if (/password|passwd|token|license|secret/i.test(key) && typeof value === 'string' && value) values.push(value);
      else if (value && typeof value === 'object') collect(value);
    }
  };
  collect(payload);
  return value => {
    let text = String(value || '');
    for (const secret of values.filter(Boolean).sort((a,b) => b.length-a.length)) text = text.split(secret).join('[redacted]');
    return text.slice(0, 500);
  };
}

async function httpJson(url, token, payload, timeoutMs = 360000, fetchImpl = globalThis.fetch) {
  const started = Date.now();
  const redact = redactor(token, payload);
  let response, text;
  try {
    response = await fetchImpl(url, {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-chatcode-token':token, 'cache-control':'no-store' },
      body:JSON.stringify(payload), redirect:'error', signal:AbortSignal.timeout(timeoutMs)
    });
    // Body-stream failures must also preserve their original cause.
    text = await response.text();
  } catch (cause) {
    const causes = [];
    let current = cause;
    for (let depth=0; current && depth<5; depth++, current=current.cause) {
      causes.push({ name:redact(current.name), code:redact(current.code), message:redact(current.message) });
    }
    const codes = [...new Set(causes.map(item => item.code).filter(Boolean))];
    const error = new Error(`Không nhận được phản hồi bootstrap${codes.length ? ` (${codes.join(' / ')})` : ''}: ${redact(cause.message)}`, { cause });
    error.code = 'BOOTSTRAP_HTTP_FAILED';
    error.detail = { action:payload.action, elapsed_ms:Date.now()-started, status:response?.status || 0, causes };
    throw error;
  }
  let body;
  try { body = JSON.parse(text.replace(/^\uFEFF/,'')); } catch {}
  if (!response.ok || !body || body.ok !== true) {
    const gateway = [408, 429, 502, 503, 504, 520, 521, 522, 523, 524].includes(response.status);
    const error = new Error(redact(body?.message || `Bootstrap HTTP ${response.status}: phản hồi không phải kết quả cài đặt hợp lệ.`));
    error.code = body?.ok === false && body.code ? body.code
      : gateway ? 'BOOTSTRAP_GATEWAY_FAILED'
      : body?.ok === false ? 'BOOTSTRAP_FAILED' : 'BOOTSTRAP_RESPONSE_INVALID';
    // Preserve structured part diagnostics required by the parallel uploader.
    const detail = body && typeof body === 'object' ? JSON.parse(JSON.stringify(body, (key,value) => {
      if (/password|passwd|token|license|secret/i.test(key)) return '[redacted]';
      return typeof value === 'string' ? redact(value) : value;
    })) : {};
    error.detail = { ...detail, action:payload.action, status:response.status, elapsed_ms:Date.now()-started };
    throw error;
  }
  return body;
}

function isUncertain(error) { return UNCERTAIN_CODES.has(error?.code); }
function requiresReconciliation(task) {
  if (task.checkpoint !== 'uploaded') return false;
  if (typeof task.install_request_pending === 'boolean') return task.install_request_pending;
  return isUncertain({ code:task.error_code }) || task.error_code === 'TASK_INTERRUPTED';
}
function sameUrl(a,b) { return String(a || '').replace(/\/+$/,'') === String(b || '').replace(/\/+$/,''); }
function checkVerified(result, payload, siteUrl) {
  // The server's verify action checks the install marker before loading WP.
  // Public HTML, a probe response, or an old/unrelated WordPress is not enough.
  if (result?.ok !== true || !result.wordpressVersion || !result.siteUrl) {
    const error = new Error('Bootstrap chưa trả đủ bằng chứng WordPress đã cài.');
    error.code='VERIFY_RESULT_INVALID'; throw error;
  }
  if (siteUrl && !sameUrl(result.siteUrl, siteUrl)) {
    const error = new Error('URL WordPress không khớp phiên cài đang kiểm tra.');
    error.code='VERIFY_SITE_URL_FAILED'; throw error;
  }
  if (payload.theme?.active_theme && result.activeTheme !== payload.theme.active_theme) {
    const error = new Error('Theme chưa đúng cấu hình cài đặt.');
    error.code='VERIFY_THEME_FAILED'; throw error;
  }
  if (payload.plugin?.entry && result.pluginActive !== true) {
    const error = new Error('Plugin mặc định chưa được kích hoạt.');
    error.code='VERIFY_PLUGIN_FAILED'; throw error;
  }
  return result;
}

async function reconcileInstall({ request, verifyPayload, siteUrl, originalError, onProgress,
  attempts=12, intervalMs=2500, requestTimeoutMs=10000, budgetMs=90000, sleep=pause }) {
  const started=Date.now();
  let lastError, checked=0;
  for (let attempt=1; attempt<=attempts && Date.now()-started<budgetMs; attempt++) {
    checked=attempt;
    onProgress?.({ attempt, elapsed_ms:Date.now()-started, original:originalError?.detail || null });
    try {
      const result=checkVerified(await request({ ...verifyPayload, action:'verify' },
        Math.max(1,Math.min(requestTimeoutMs,budgetMs-(Date.now()-started)))),verifyPayload,siteUrl);
      return { ...result, recoveredAfterDisconnect:true };
    } catch (error) {
      lastError=error;
      if (VERIFY_FAILURES.has(error.code)) {
        error.reconciliationOnly=true;
        throw error;
      }
      // A missing marker can mean PHP is still publishing. Wait, don't install.
    }
    const remaining=budgetMs-(Date.now()-started);
    if (attempt<attempts && remaining>0) await sleep(Math.min(intervalMs,remaining));
  }
  const error=new Error('Chưa xác nhận được kết quả trên hosting. WordPress có thể đã cài hoặc vẫn đang chạy; giữ nguyên website và kiểm tra lại, không cài lại.');
  error.code='INSTALL_RESULT_UNCONFIRMED';
  error.reconciliationOnly=true;
  error.detail={ attempts:checked, elapsed_ms:Date.now()-started,
    original:originalError?.detail || { code:originalError?.code || '' },
    last_check:lastError?.detail || { code:lastError?.code || '', message:lastError?.message || '' } };
  throw error;
}

async function installWithReconciliation(options) {
  try { return await options.request(options.installPayload, options.installTimeoutMs || 420000); }
  catch (error) {
    if (!isUncertain(error)) throw error;
    return reconcileInstall({ ...options, originalError:error });
  }
}
module.exports={ httpJson, isUncertain, requiresReconciliation, checkVerified, reconcileInstall, installWithReconciliation };
