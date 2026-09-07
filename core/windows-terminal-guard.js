const { chatError } = require('./errors');

const MAX_DISPLAY_JOBS = 200;

function hasUnsafeCmdArrow(value) {
  const text = String(value || '');
  let inDouble = false;
  let caretEscape = false;
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i];
    if (caretEscape) { caretEscape = false; continue; }
    if (!inDouble && ch === '^') { caretEscape = true; continue; }
    if (ch === '"') { inDouble = !inDouble; continue; }
    if (!inDouble && ch === '=' && text[i + 1] === '>') return true;
  }
  return false;
}

function parsePhpInlineCommand(value) {
  const raw = String(value || '').trim();
  const match = /^\s*(?:"([^"]+)"|([^\s]+))\s+-r\s+([\s\S]+)$/i.exec(raw);
  if (!match) return null;
  const executable = String(match[1] || match[2] || '').trim();
  if (!/(?:^|[\\/])php(?:\.exe)?$/i.test(executable)) return null;
  let code = String(match[3] || '').trim();
  if (!code) return null;
  const quote = code[0];
  if ((quote === "'" || quote === '"') && code[code.length - 1] === quote) code = code.slice(1, -1);
  return { executable, code };
}

function encodePowerShell(script) {
  return Buffer.from(String(script || ''), 'utf16le').toString('base64');
}

function buildSafePhpInlineCommand(value) {
  const parsed = parsePhpInlineCommand(value);
  if (!parsed || !hasUnsafeCmdArrow(value)) return null;
  const exe64 = Buffer.from(parsed.executable, 'utf8').toString('base64');
  const code64 = Buffer.from(parsed.code, 'utf8').toString('base64');
  const script = [
    "$ErrorActionPreference='Stop'",
    `$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${exe64}'))`,
    `$code=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${code64}'))`,
    '& $exe -r $code',
    'if($null -eq $LASTEXITCODE){exit 1}',
    'exit $LASTEXITCODE'
  ].join('\n');
  return `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encodePowerShell(script)}`;
}

function decorateCommand(result, original) {
  if (!result || !original) return result;
  return { ...result, command:original, command_transport:'windows-safe-inline' };
}

function createWindowsTerminalGuardApi(api, platform = process.platform) {
  if (!api || typeof api.exec !== 'function' || api.__windowsTerminalGuardWrapped) return api;
  api.__windowsTerminalGuardWrapped = true;
  const originalExec = api.exec.bind(api);
  const originalStatus = typeof api.jobStatus === 'function' ? api.jobStatus.bind(api) : null;
  const originalList = typeof api.listTerminalJobs === 'function' ? api.listTerminalJobs.bind(api) : null;
  const displayCommands = new Map();

  function remember(jobId, command) {
    const id = String(jobId || '');
    if (!id) return;
    displayCommands.set(id, command);
    while (displayCommands.size > MAX_DISPLAY_JOBS) displayCommands.delete(displayCommands.keys().next().value);
  }

  api.exec = async (ref, command, opts = {}) => {
    const raw = String(command || '').trim();
    if (platform !== 'win32' || !hasUnsafeCmdArrow(raw)) return originalExec(ref, command, opts);

    const safePhp = buildSafePhpInlineCommand(raw);
    if (!safePhp) {
      throw chatError(
        'TASK_NOT_ALLOWED',
        'Lệnh Windows chứa toán tử code => ở ngoài dấu nháy kép. cmd.exe sẽ hiểu > là redirect và có thể tạo file rác trong project.',
        {
          command:raw.slice(0, 320),
          trusted_terminal:true,
          shell:'cmd.exe',
          redirect_artifact_guard:true,
          next_action:'Dùng command được quote an toàn cho Windows hoặc ghi script tạm ngoài project rồi chạy bằng interpreter; không chạy code => trực tiếp qua cmd.exe.'
        }
      );
    }

    const result = await originalExec(ref, safePhp, opts);
    remember(result?.job_id, raw);
    return decorateCommand(result, raw);
  };

  if (originalStatus) {
    api.jobStatus = (jobId, opts = {}) => decorateCommand(originalStatus(jobId, opts), displayCommands.get(String(jobId || '')) || '');
  }
  if (originalList) {
    api.listTerminalJobs = ref => originalList(ref).map(item => decorateCommand(item, displayCommands.get(String(item?.job_id || '')) || ''));
  }
  return api;
}

function installWindowsTerminalGuardPatches() {
  const safety = require('./safety-tools');
  if (safety.__windowsTerminalGuardPatched) return;
  safety.__windowsTerminalGuardPatched = true;
  const previousCreate = safety.createSafeToolApi;
  safety.createSafeToolApi = function windowsTerminalGuardSafeToolApi(...args) {
    return createWindowsTerminalGuardApi(previousCreate(...args));
  };
}

module.exports = {
  hasUnsafeCmdArrow,
  parsePhpInlineCommand,
  buildSafePhpInlineCommand,
  createWindowsTerminalGuardApi,
  installWindowsTerminalGuardPatches
};
