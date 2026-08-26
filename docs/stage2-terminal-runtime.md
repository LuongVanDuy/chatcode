# V1.0 Stage 2 — Terminal Runtime

Stage 2 adds a real shell runtime for projects explicitly switched to **Trusted Workspace**.

## MCP contract

- `exec(project, command, cwd?, background?, timeout_ms?)`
- `job_status(job_id, stdout_offset?, stderr_offset?)`
- `job_stop(job_id)`

Safe Workspace continues to use the legacy `run_task` allow-list.

## Runtime behavior

- Windows processes always request `windowsHide: true`.
- Foreground commands return captured stdout/stderr on process exit.
- Background commands return a job id immediately and retain bounded stdout/stderr for incremental reads.
- Background completion records exactly one task-completion activity; starting or manually stopping a background job does not emit the completion notification.
- `cwd` must resolve to an existing directory inside the selected project.
- Process trees can be stopped; retained completed jobs expire automatically.
- Git push, `git reset --hard`, OS shutdown and disk/boot management commands are blocked by the terminal command guard.

## Security boundary

The file APIs remain canonical-path confined to the project root. The generic terminal is **not an operating-system filesystem sandbox**: a program launched by the shell still has the filesystem permissions of the Windows account running ChatCode. The UI and MCP metadata state this explicitly.

## Validation

`npm run test:terminal` covers Safe denial, Trusted chaining, pipes, cwd validation, command guard, foreground execution, background streaming, offsets, completion activity, stop, timeout, process audit and Windows hidden-process behavior.
