import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';

function result(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return { content: [{ type: 'text', text }] };
}

function errorResult(error) {
  return { content: [{ type: 'text', text: `Error: ${String(error?.message || error)}` }], isError: true };
}

function wrap(fn) {
  return async (args) => {
    try { return result(await fn(args || {})); }
    catch (error) { return errorResult(error); }
  };
}

function buildMcpServer(api) {
  const server = new McpServer(
    { name: 'personal-chatcode', version: '0.2.0' },
    { instructions: 'This server gives ChatGPT controlled access to folders explicitly added by the user. Start with list_projects. Use read/search tools before editing. Never request secrets or blocked files. Respect each project permission. After changes, inspect git diff and run relevant tests only when task permission is enabled.' }
  );

  server.registerTool('list_projects', {
    title: 'List projects',
    description: 'List folders the user has explicitly shared with Personal ChatCode, including current permissions.',
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true }
  }, wrap(async () => api.listProjects()));

  server.registerTool('list_files', {
    title: 'List project files',
    description: 'List non-sensitive files inside one shared project. Build/cache folders are skipped.',
    inputSchema: z.object({ project: z.string().describe('Project id or exact project name'), limit: z.number().int().min(1).max(5000).optional() }),
    annotations: { readOnlyHint: true }
  }, wrap(({ project, limit }) => api.listFiles(project, limit)));

  server.registerTool('search_project', {
    title: 'Search project',
    description: 'Search filenames and UTF-8 text/code content in a project and return ranked snippets.',
    inputSchema: z.object({ project: z.string().describe('Project id or exact project name'), query: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, wrap(({ project, query }) => api.search(project, query)));

  server.registerTool('read_file', {
    title: 'Read file',
    description: 'Read one UTF-8 text/code file inside a shared project. Sensitive files are blocked.',
    inputSchema: z.object({ project: z.string(), path: z.string().min(1) }),
    annotations: { readOnlyHint: true }
  }, wrap(({ project, path }) => api.readFile(project, path)));

  server.registerTool('read_files', {
    title: 'Read multiple files',
    description: 'Read up to 12 UTF-8 text/code files from one project in a single call.',
    inputSchema: z.object({ project: z.string(), paths: z.array(z.string().min(1)).min(1).max(12) }),
    annotations: { readOnlyHint: true }
  }, wrap(({ project, paths }) => api.readFiles(project, paths)));

  server.registerTool('write_file', {
    title: 'Create or replace file',
    description: 'Create or replace a UTF-8 text file. Requires Write permission for the project.',
    inputSchema: z.object({ project: z.string(), path: z.string().min(1), content: z.string() }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, wrap(({ project, path, content }) => api.writeFile(project, path, content)));

  server.registerTool('delete_file', {
    title: 'Delete file',
    description: 'Delete one file. Requires Create/delete/rename permission.',
    inputSchema: z.object({ project: z.string(), path: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, wrap(({ project, path }) => api.deleteFile(project, path)));

  server.registerTool('rename_file', {
    title: 'Rename file',
    description: 'Rename or move one file within the same project. Requires Create/delete/rename permission.',
    inputSchema: z.object({ project: z.string(), from: z.string().min(1), to: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, wrap(({ project, from, to }) => api.renameFile(project, from, to)));

  server.registerTool('run_task', {
    title: 'Run development task',
    description: 'Run an allow-listed development command such as npm test, npm run build, pytest, cargo test, go test, or dotnet test. Requires Task permission.',
    inputSchema: z.object({ project: z.string(), command: z.string().min(1) }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, wrap(({ project, command }) => api.runTask(project, command)));

  server.registerTool('git_status', {
    title: 'Git status',
    description: 'Read git branch/status for a project.',
    inputSchema: z.object({ project: z.string() }),
    annotations: { readOnlyHint: true }
  }, wrap(({ project }) => api.gitStatus(project)));

  server.registerTool('git_diff', {
    title: 'Git diff',
    description: 'Read unstaged or staged git diff for a project.',
    inputSchema: z.object({ project: z.string(), staged: z.boolean().optional() }),
    annotations: { readOnlyHint: true }
  }, wrap(({ project, staged }) => api.gitDiff(project, !!staged)));

  server.registerTool('git_stage', {
    title: 'Stage git files',
    description: 'Stage explicit non-sensitive file paths. Requires Git write permission. Wildcard/all-project staging is intentionally not provided.',
    inputSchema: z.object({ project: z.string(), paths: z.array(z.string().min(1)).min(1).max(100) }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, wrap(({ project, paths }) => api.gitStage(project, paths)));

  server.registerTool('git_commit', {
    title: 'Create local git commit',
    description: 'Commit already staged changes locally. Requires Git write permission. This tool never pushes.',
    inputSchema: z.object({ project: z.string(), message: z.string().min(1).max(300) }),
    annotations: { readOnlyHint: false, destructiveHint: true }
  }, wrap(({ project, message }) => api.gitCommit(project, message)));

  return server;
}

export async function startMcpHttpServer({ port, token, api }) {
  const route = `/${token}/mcp`;

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, service: 'personal-chatcode' }));
      return;
    }

    if (url.pathname !== route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    if (!['POST', 'GET', 'DELETE'].includes(req.method || '')) {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    const server = buildMcpServer(api);
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: String(error?.message || error) }, id: null }));
      }
    } finally {
      try { await transport.close(); } catch {}
      try { await server.close(); } catch {}
    }
  });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', resolve);
  });

  return {
    route,
    localUrl: `http://127.0.0.1:${port}${route}`,
    close: () => new Promise(resolve => httpServer.close(() => resolve()))
  };
}
