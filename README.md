# Personal ChatCode

A local-first personal AI coding workspace inspired by the workflow of ChatCode, built from scratch for private use.

## What works in v0.1

- Add any local folder as a project.
- Read-only by default.
- Block common secret locations/files such as `.env`, `.ssh`, private keys and credentials files.
- Browse and preview text files.
- Search project filenames and text content.
- Connect an OpenAI-compatible API endpoint with your own model/API key.
- Agent tool loop: search files, read files, write files, run allow-listed dev tasks, inspect Git status/diff.
- Per-project permission switches for file writes and task execution.
- API key stored using Electron `safeStorage` (Windows DPAPI when available).
- No telemetry.

## Run on Windows

Install Node.js 24+, then:

```powershell
npm install
npm start
```

Open **Settings**, configure your AI base URL, model name and API key, then add a project.

## Build an installer

```powershell
npm install
npm run dist:win
```

The NSIS installer will be created under `dist/`.

A GitHub Actions workflow is also included so Windows can build the `.exe` automatically on pushes/tags.

## Safety model

Projects are isolated by their selected root folder. Relative paths are resolved and checked so tools cannot escape the project root. Sensitive names are blocked. File modification and task execution are opt-in per project.

Task execution uses an allow-list for common developer tools and does not execute through a shell.

## Next milestones

1. Symbol/import graph (“Project Brain”) with Tree-sitter.
2. Patch/diff review UI before writes.
3. Local Git stage/commit with explicit confirmation.
4. Multiple providers (OpenAI, Anthropic, Gemini and local Ollama).
5. SSH/SFTP project bindings.
6. Remote relay/mobile control.
7. Signed auto-update and a small bootstrap installer.

## Branding

This repo intentionally uses **Personal ChatCode** as a placeholder. For a personal build, change `productName`, `appId`, title, icons and installer metadata to your own branding.
