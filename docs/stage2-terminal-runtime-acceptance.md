# Stage 2 acceptance checklist

- [ ] Syntax checks pass.
- [ ] MCP exposes exactly 24 tools including `exec`, `job_status`, `job_stop`.
- [ ] Safe Workspace rejects generic `exec`.
- [ ] Trusted Workspace runs chained and piped commands.
- [ ] Trusted `cwd` cannot be set outside the project.
- [ ] Background jobs stream stdout/stderr with monotonic offsets.
- [ ] Background completion records one completion activity.
- [ ] User-stopped background jobs do not record a false completion notification.
- [ ] Process-tree stop works on Windows.
- [ ] Foreground timeout works.
- [ ] `git push` and `git reset --hard` are blocked by the terminal guard.
- [ ] Windows process audit sees `windowsHide=true` for terminal shells/tasks.
- [ ] Existing Safety, Trusted Workspace, Brain, WordPress, fast-path, filesystem/task and updater tests stay green.
- [ ] Windows installer builds and updater metadata is generated.
- [ ] Remote MCP tunnel smoke passes.
