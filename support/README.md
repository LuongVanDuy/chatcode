# ChatCode Support Journal

ChatCode v0.9 keeps support data on the user's machine under the Electron `userData/support` folder.

## Local files

- `notes.md` — notes entered by the user in **Cài đặt → Ghi chú lỗi & Terminal Audit**.
- `terminal-events/YYYY-MM-DD.jsonl` — append-only child-process audit events.

Terminal audit records metadata only: timestamp, process type, executable basename, sanitized arguments, PID, exit code, duration and whether `windowsHide` was enabled. It does **not** record stdout/stderr, file contents or absolute working directories. Tunnel tokens, MCP secrets and credential-like strings are redacted.

The **Vừa thấy terminal nháy** button writes a manual timestamp marker so a later support report can correlate the visible flash with nearby process events.

## GitHub support

The installed app does not embed a GitHub write token and does not silently upload local support data to this public repository. The **Gửi lên GitHub** action opens a pre-filled GitHub Issue containing the user's note and a limited set of recent sanitized process events. The user can review the payload before submitting it publicly.
