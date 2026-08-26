# ChatCode Support Journal

ChatCode v0.9 keeps support data on the user's machine under the Electron `userData/support` folder.

## Local files

- `notes.md` — notes entered by the user in **Cài đặt → Ghi chú lỗi & Terminal Audit**.
- `terminal-events/YYYY-MM-DD.jsonl` — append-only child-process audit events.

Terminal audit records metadata only: timestamp, process type, executable basename, sanitized arguments, PID, exit code, duration and whether `windowsHide` was enabled. It does **not** record stdout/stderr, file contents or absolute working directories. Tunnel tokens, MCP secrets and credential-like strings are redacted.

The **Vừa thấy terminal nháy** button writes a manual timestamp marker so a later support report can correlate the visible flash with nearby process events.

## Privacy boundary

Support data stays local until the user explicitly chooses a share action. The app never embeds a repository write token and never silently commits runtime logs to this public repository.

## GitHub support

The **Gửi lên GitHub** action opens a pre-filled GitHub Issue containing the user's note and a limited set of recent sanitized process events. The user can review the payload before submitting it publicly.

The Windows CI regression suite also validates hidden `.cmd/.bat` execution so `npm`, `npm.cmd`, `npx`, `pnpm`, `yarn` and `gradle.bat` do not regress into visible console launches.
