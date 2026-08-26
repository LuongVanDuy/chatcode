# Personal ChatCode

Personal ChatCode is a local project bridge for **ChatGPT**. It does not contain an AI chat client and it does not call the OpenAI API.

The intended workflow is the same shape as ChatCode:

**ChatGPT → Remote MCP URL → local Personal ChatCode → projects on your computer**

## v0.2: ChatGPT-only architecture

- Add local folders as independent projects.
- Read/search is available by default.
- Per-project switches for file writes, delete/rename, development tasks and local Git writes.
- Common secrets such as `.env`, `.ssh`, private keys and credentials are blocked.
- MCP tools exposed to ChatGPT:
  - `list_projects`
  - `list_files`
  - `search_project`
  - `read_file` / `read_files`
  - `write_file`
  - `delete_file` / `rename_file`
  - `run_task`
  - `git_status` / `git_diff`
  - `git_stage` / `git_commit`
- The MCP server only listens on `127.0.0.1`.
- A Cloudflare Quick Tunnel is created for ChatGPT, and the MCP endpoint includes a long random secret in its path.
- The secret can be rotated from the desktop app.
- No OpenAI API key, model selector, embedded AI chat, license system or telemetry.

## Use with ChatGPT

1. Start Personal ChatCode.
2. Add the folder(s) ChatGPT may access.
3. Open **Connect ChatGPT** in the app and copy the Remote MCP URL.
4. In ChatGPT, add/create your custom MCP app/plugin and paste that URL.
5. In a normal ChatGPT conversation, ask: `Use Personal ChatCode and list my projects.`

Keep Personal ChatCode running while ChatGPT is using your computer. The Quick Tunnel URL can change when the app restarts, so you may need to update the URL in ChatGPT.

ChatGPT support for custom MCP apps and write actions depends on the ChatGPT plan/workspace and current OpenAI product availability. If your existing ChatCode connector works in your ChatGPT account, use the same connector/app area for this URL.

## Run from source

Install Node.js 24+, then:

```powershell
npm install
npm start
```

On first connection, the app downloads the `cloudflared` tunnel helper into its user-data directory.

## Build the Windows installer

```powershell
npm install
npm run dist:win
```

The NSIS installer is created in `dist/`. GitHub Actions also builds the Windows installer on pushes to `main` and version tags.

## Permission model

Every project is a folder boundary. Tool paths are resolved against that boundary and rejected if they escape it.

- **READ** — list/search/read text files; enabled by default.
- **WRITE** — create or replace text files.
- **MANAGE** — delete, rename or move files.
- **TASKS** — run an allow-list of common developer commands without a shell.
- **GIT WRITE** — stage explicit non-sensitive paths and create local commits. There is no Git push tool.

## Current gap vs. ChatCode

This is not yet a feature-for-feature clone. The main missing piece is a real **Project Brain**: persistent symbol/import/reference indexing for large codebases. Current search is filename/text based. That is the next major milestone.

Other later milestones: patch/diff approval UI, richer symbol search, stable tunnel option, SFTP/SSH bindings and signed auto-update.
