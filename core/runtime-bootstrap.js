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
  // Must be the final compatibility layer: older ChatGPT connector schemas may
  // still expose only the original 13 tools. This adds CHATCODE-GPT as a
  // read-only virtual project so those tools can discover/read built-in skills,
  // while newer schemas continue to use prepare_task automatic skill loading.
  const { installBuiltinSkillsProjectPatches } = require('./builtin-skills-project');
  installBuiltinSkillsProjectPatches();
  return true;
}

module.exports = { installRuntimePatches };
