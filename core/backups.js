const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MAX_RECORDS = 160;
const MAX_TOTAL_BYTES = 350 * 1024 * 1024;

function createBackupService(app, store, { onChanged } = {}) {
  const root = () => path.join(app.getPath('userData'), 'recovery');

  async function ensureRoot() { await fsp.mkdir(root(), { recursive: true }); }
  function recordDir(id) { return path.join(root(), id); }
  function metaFile(id) { return path.join(recordDir(id), 'meta.json'); }
  function dataFile(id) { return path.join(recordDir(id), 'data.bin'); }

  async function readMeta(id) {
    try { return JSON.parse(await fsp.readFile(metaFile(id), 'utf8')); }
    catch { return null; }
  }

  async function list(projectId = '') {
    await ensureRoot();
    let names = [];
    try { names = await fsp.readdir(root()); } catch {}
    const items = [];
    for (const name of names.slice(0, 500)) {
      const meta = await readMeta(name);
      if (!meta) continue;
      if (projectId && meta.projectId !== projectId) continue;
      items.push({
        id: meta.id,
        createdAt: meta.createdAt,
        projectId: meta.projectId,
        project: meta.project,
        path: meta.path,
        reason: meta.reason,
        size: Number(meta.size) || 0
      });
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async function prune() {
    const items = await list();
    let total = items.reduce((sum, item) => sum + item.size, 0);
    for (let i = 0; i < items.length; i++) {
      if (i < MAX_RECORDS && total <= MAX_TOTAL_BYTES) continue;
      try { await fsp.rm(recordDir(items[i].id), { recursive: true, force: true }); } catch {}
      total -= items[i].size;
    }
  }

  async function snapshot(project, relPath, absolutePath, reason) {
    if (!store.settings().backupBeforeChanges) return null;
    let stat;
    try { stat = await fsp.stat(absolutePath); } catch { return null; }
    if (!stat.isFile()) return null;
    const id = crypto.randomUUID();
    const dir = recordDir(id);
    await fsp.mkdir(dir, { recursive: true });
    const meta = {
      id,
      createdAt: new Date().toISOString(),
      projectId: project.id,
      project: project.name,
      path: String(relPath || ''),
      reason: String(reason || 'change').slice(0, 120),
      size: stat.size
    };
    try {
      await fsp.copyFile(absolutePath, dataFile(id));
      await fsp.writeFile(metaFile(id), JSON.stringify(meta, null, 2), 'utf8');
    } catch (error) {
      try { await fsp.rm(dir, { recursive: true, force: true }); } catch {}
      throw new Error(`Không thể tạo recovery snapshot trước khi thay đổi file: ${error.message || error}`);
    }
    prune().catch(() => {});
    onChanged?.();
    return meta;
  }

  async function restore(id, secureResolve) {
    const meta = await readMeta(String(id));
    if (!meta) throw new Error('Không tìm thấy recovery snapshot.');
    const project = store.getProject(meta.projectId);
    const source = dataFile(meta.id);
    const target = await secureResolve(project, meta.path);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const verified = await secureResolve(project, meta.path);
    await fsp.copyFile(source, verified);
    onChanged?.();
    return { ok: true, projectId: project.id, project: project.name, path: meta.path, restoredAt: new Date().toISOString() };
  }

  async function remove(id) {
    const meta = await readMeta(String(id));
    if (!meta) return false;
    await fsp.rm(recordDir(meta.id), { recursive: true, force: true });
    onChanged?.();
    return true;
  }

  async function clear(projectId = '') {
    if (!projectId) {
      await fsp.rm(root(), { recursive: true, force: true });
      await ensureRoot();
    } else {
      const items = await list(projectId);
      for (const item of items) await fsp.rm(recordDir(item.id), { recursive: true, force: true });
    }
    onChanged?.();
    return true;
  }

  return { snapshot, list, restore, remove, clear };
}

module.exports = { createBackupService };
