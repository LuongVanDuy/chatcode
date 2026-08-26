const { createBrainService } = require('./brain');

const SENSITIVE_NAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'credentials.json']);
function normalizeRel(value) { return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, ''); }
function isSensitive(relPath) {
  return normalizeRel(relPath).split('/').filter(Boolean).some(part => SENSITIVE_NAMES.has(part.toLowerCase()) || part.toLowerCase() === '.ssh' || /private.*key/i.test(part));
}
function requirePermission(project, key, label) {
  if (!project.permissions?.[key]) throw new Error(`Quyền ${label} đang tắt cho dự án "${project.name}".`);
}

function createSafeToolApi(projects, store, approvals, backups) {
  const base = projects.toolApi;
  const brain = createBrainService(store, projects);

  async function maybeExisting(project, rel) {
    try { return await projects.secureResolve(project, rel, { mustExist: true }); }
    catch (error) {
      if (/ENOENT|không tồn tại/i.test(String(error?.message || error))) return null;
      if (error?.code === 'ENOENT') return null;
      return null;
    }
  }

  return {
    listProjects: (...args) => base.listProjects(...args),
    listFiles: (...args) => base.listFiles(...args),
    search: (...args) => base.search(...args),
    readFile: (...args) => base.readFile(...args),
    readFiles: (...args) => base.readFiles(...args),

    projectBrain: (...args) => brain.projectBrain(...args),
    findSymbols: (...args) => brain.findSymbols(...args),
    findReferences: (...args) => brain.findReferences(...args),
    relatedFiles: (...args) => brain.relatedFiles(...args),
    projectContext: (...args) => brain.projectContext(...args),
    brainStatus: (...args) => brain.status(...args),
    rebuildBrain: (...args) => brain.rebuild(...args),

    async writeFile(ref, relPath, content) {
      const project = store.getProject(ref);
      requirePermission(project, 'write', 'ghi file');
      const rel = normalizeRel(relPath);
      if (!rel || isSensitive(rel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
      await projects.secureResolve(project, rel);
      await approvals.request(project.id, 'write', { target: rel, detail: `Tạo hoặc thay thế ${rel}` });
      const existing = await maybeExisting(project, rel);
      const snapshot = existing ? await backups.snapshot(project, rel, existing, 'overwrite') : null;
      const result = await base.writeFile(project.id, rel, content);
      brain.invalidate(project.id);
      return snapshot ? { ...result, recoveryId: snapshot.id } : result;
    },

    async deleteFile(ref, relPath) {
      const project = store.getProject(ref);
      requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
      const rel = normalizeRel(relPath);
      if (!rel || isSensitive(rel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
      const target = await projects.secureResolve(project, rel, { mustExist: true });
      await approvals.request(project.id, 'delete', { target: rel, detail: `Xóa file ${rel}` });
      const snapshot = await backups.snapshot(project, rel, target, 'delete');
      const result = await base.deleteFile(project.id, rel);
      brain.invalidate(project.id);
      return snapshot ? { ...result, recoveryId: snapshot.id } : result;
    },

    async renameFile(ref, fromPath, toPath) {
      const project = store.getProject(ref);
      requirePermission(project, 'manageFiles', 'xóa/đổi tên file');
      const fromRel = normalizeRel(fromPath), toRel = normalizeRel(toPath);
      if (!fromRel || !toRel || isSensitive(fromRel) || isSensitive(toRel)) throw new Error('File nhạy cảm hoặc đường dẫn không hợp lệ đã bị chặn.');
      const source = await projects.secureResolve(project, fromRel, { mustExist: true });
      await projects.secureResolve(project, toRel);
      await approvals.request(project.id, 'rename', { target: `${fromRel} → ${toRel}`, detail: `Đổi tên/di chuyển file trong ${project.name}` });
      const snapshot = await backups.snapshot(project, fromRel, source, 'rename');
      const result = await base.renameFile(project.id, fromRel, toRel);
      brain.invalidate(project.id);
      return snapshot ? { ...result, recoveryId: snapshot.id } : result;
    },

    async runTask(ref, commandLine) {
      const project = store.getProject(ref);
      requirePermission(project, 'tasks', 'chạy tác vụ');
      const command = String(commandLine || '').trim();
      await approvals.request(project.id, 'task', { target: command.slice(0, 220), detail: 'Chạy development task theo allowlist của ChatCode.' });
      return base.runTask(project.id, command);
    },

    gitStatus: (...args) => base.gitStatus(...args),
    gitDiff: (...args) => base.gitDiff(...args),

    async gitStage(ref, paths) {
      const project = store.getProject(ref);
      requirePermission(project, 'gitWrite', 'ghi Git');
      const list = Array.isArray(paths) ? paths.slice(0, 100).map(normalizeRel).filter(Boolean) : [];
      await approvals.request(project.id, 'gitStage', { target: `${list.length} file`, detail: list.slice(0, 8).join(', ') });
      return base.gitStage(project.id, list);
    },

    async gitCommit(ref, message) {
      const project = store.getProject(ref);
      requirePermission(project, 'gitWrite', 'ghi Git');
      const text = String(message || '').trim();
      await approvals.request(project.id, 'gitCommit', { target: text.slice(0, 220), detail: 'Tạo local Git commit. ChatCode không push.' });
      return base.gitCommit(project.id, text);
    },

    recordActivity: base.recordActivity
  };
}

module.exports = { createSafeToolApi };
