function installRuntimePatches() {
  const { installTrustedWorkspacePatches } = require('./trusted-workspace');
  installTrustedWorkspacePatches();
  const { installTerminalRuntimePatches } = require('./terminal-runtime');
  installTerminalRuntimePatches();
  const { installWorkRuntimePatches } = require('./work-runtime');
  installWorkRuntimePatches();
  const { installAgentRuntimePatches } = require('./agent-runtime');
  installAgentRuntimePatches();
  return true;
}

module.exports = { installRuntimePatches };
