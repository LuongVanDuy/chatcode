function installRuntimePatches() {
  const { installTrustedWorkspacePatches } = require('./trusted-workspace');
  installTrustedWorkspacePatches();
  const { installTerminalRuntimePatches } = require('./terminal-runtime');
  installTerminalRuntimePatches();
  const { installWorkRuntimePatches } = require('./work-runtime');
  installWorkRuntimePatches();
  // Scope WordPress source-content retrieval before Fast Agent captures inspectProject.
  // Project Brain may still index broadly; only content reads are narrowed.
  const { installRetrievalScopePatches } = require('./retrieval-scope');
  installRetrievalScopePatches();
  const { installAgentRuntimePatches } = require('./agent-runtime');
  installAgentRuntimePatches();
  // Install after Agent so task grouping sees Terminal, Work Session and Fast Agent calls.
  const { installTaskPolicyPatches } = require('./task-policy');
  installTaskPolicyPatches();
  // Compatibility layer for older ChatGPT connector schemas that expose only
  // the original 13 tools. It adds CHATCODE-GPT as a read-only virtual project.
  const { installBuiltinSkillsProjectPatches } = require('./builtin-skills-project');
  installBuiltinSkillsProjectPatches();
  // Mandatory WordPress + Bricks policy must see both modern and legacy paths.
  const { installSkillPolicyPatches } = require('./skill-policy');
  installSkillPolicyPatches();
  // Final outer policy: once a target project is established, every project-aware
  // read/write stays inside that target unless the user's task explicitly names
  // a multi-project reference. Reference projects are read-only.
  const { installProjectScopePatches } = require('./project-scope');
  installProjectScopePatches();
  return true;
}

module.exports = { installRuntimePatches };
