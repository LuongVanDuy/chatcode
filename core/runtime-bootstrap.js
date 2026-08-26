function installRuntimePatches() {
  const { installTrustedWorkspacePatches } = require('./trusted-workspace');
  installTrustedWorkspacePatches();
  const { installTerminalRuntimePatches } = require('./terminal-runtime');
  installTerminalRuntimePatches();
  const { installCodexEditingPatches } = require('./codex-editing');
  installCodexEditingPatches();
  return true;
}

module.exports = { installRuntimePatches };
