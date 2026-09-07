function installRuntimePatches() {
  const { installTrustedWorkspacePatches } = require('./trusted-workspace');
  installTrustedWorkspacePatches();
  const { installTerminalRuntimePatches } = require('./terminal-runtime');
  installTerminalRuntimePatches();
  // Windows cmd.exe treats > inside unquoted code arrows (=>) as output redirection.
  // Guard/rewrite unsafe inline interpreter commands before Work Session captures exec.
  const { installWindowsTerminalGuardPatches } = require('./windows-terminal-guard');
  installWindowsTerminalGuardPatches();
  const { installWorkRuntimePatches } = require('./work-runtime');
  installWorkRuntimePatches();
  // Scope WordPress source-content retrieval before Fast Agent captures inspectProject.
  // Project Brain may still index broadly; only content reads are narrowed.
  const { installRetrievalScopePatches } = require('./retrieval-scope');
  installRetrievalScopePatches();
  const { installAgentRuntimePatches } = require('./agent-runtime');
  installAgentRuntimePatches();
  // A completed Work Session may deploy only its changed files through the project's
  // local .vscode/sftp.json. Credentials stay inside the terminal process.
  const { installFtpDeployPatches } = require('./ftp-deploy');
  installFtpDeployPatches();
  // Promote FTP deploy outcome into Fast Agent completion so failed upload cannot be reported as fully done.
  const { installCompletionDeployPolicyPatches } = require('./completion-deploy-policy');
  installCompletionDeployPolicyPatches();
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
  // Git is an explicit integration, not a default coding dependency. Install the
  // lazy boundary before Project Scope so explicit Git calls still inherit scope guards.
  const { installGitLazyPatches } = require('./git-lazy');
  installGitLazyPatches();
  // Final scope policy keeps each task/session inside its project lane.
  const { installProjectScopePatches } = require('./project-scope');
  installProjectScopePatches();
  // Outermost performance policy: coalesce duplicate in-flight reads/Git status,
  // parallelize bounded read batches and expose aggregate latency counters without
  // weakening any inner safety/scope/skill contract.
  const { installFastExecutionPatches } = require('./fast-execution');
  installFastExecutionPatches();
  return true;
}

module.exports = { installRuntimePatches };
