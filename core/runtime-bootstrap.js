function installRuntimePatches() {
  const { installTrustedWorkspacePatches } = require('./trusted-workspace');
  installTrustedWorkspacePatches();
  const { installTerminalRuntimePatches } = require('./terminal-runtime');
  installTerminalRuntimePatches();
  const { installWorkRuntimePatches } = require('./work-runtime');
  installWorkRuntimePatches();
  const { installAgentRuntimePatches } = require('./agent-runtime');
  installAgentRuntimePatches();
  // Install last so this policy sees the final composed API and can group
  // notifications across Terminal, Work Session and Fast Agent calls.
  const { installTaskPolicyPatches } = require('./task-policy');
  installTaskPolicyPatches();
  return true;
}

module.exports = { installRuntimePatches };
