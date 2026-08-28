function installRuntimePatches() {
  const { installTrustedWorkspacePatches } = require('./trusted-workspace');
  installTrustedWorkspacePatches();
  const { installTerminalRuntimePatches } = require('./terminal-runtime');
  installTerminalRuntimePatches();
  const { installWorkRuntimePatches } = require('./work-runtime');
  installWorkRuntimePatches();
  const { installAgentRuntimePatches } = require('./agent-runtime');
  installAgentRuntimePatches();
  // Install after Agent so task grouping sees Terminal, Work Session and Fast Agent calls.
  const { installTaskPolicyPatches } = require('./task-policy');
  installTaskPolicyPatches();
  // Compatibility layer for older ChatGPT connector schemas that expose only
  // the original 13 tools. It adds CHATCODE-GPT as a read-only virtual project.
  const { installBuiltinSkillsProjectPatches } = require('./builtin-skills-project');
  installBuiltinSkillsProjectPatches();
  // Final policy layer. It must see both modern Fast Agent methods and the
  // legacy CHATCODE-GPT compatibility project so WordPress + Bricks work can
  // never silently bypass the mandatory wordpress-bricks skill.
  const { installSkillPolicyPatches } = require('./skill-policy');
  installSkillPolicyPatches();
  return true;
}

module.exports = { installRuntimePatches };
