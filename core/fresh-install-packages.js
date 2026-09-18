const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const PACKAGE_SCHEMA = 1;
const MAX_PACKAGE_BYTES = 160 * 1024 * 1024;

const DEFAULT_CATALOG = Object.freeze({
  schema: 1,
  wordpress: {
    source: 'wordpress.org',
    version: 'latest',
    download_url: 'https://wordpress.org/latest.zip'
  },
  themes: [
    {
      id: 'bricks',
      name: 'Bricks',
      source: 'managed',
      version: '2.4',
      latest_stable: '2.4',
      expected_root: 'bricks',
      expected_entry: 'bricks/style.css',
      requires_package: true,
      generated_child: 'bricks-child',
      active_theme: 'bricks-child'
    },
    {
      id: 'wordpress-default',
      name: 'WordPress mặc định',
      source: 'wordpress-core',
      version: 'latest',
      requires_package: false,
      active_theme: ''
    }
  ],
  plugins: [
    {
      id: 'duyanhwebpro',
      name: 'Duy Anh Web Pro',
      source: 'vendor-manifest',
      required: true,
      activate: true,
      fallback_version: '1.9.4',
      slug: 'duyanhwebpro',
      entry: 'duyanhwebpro/duyanhwebpro.php',
      manifest_url: 'https://webdep.io.vn/dabricks/wp-content/uploads/duyanhwebpro-updates/update.json'
    }
  ],
  presets: [
    {
      id: 'bricks-standard',
      name: 'Bricks Standard',
      theme: 'bricks',
      plugins: ['duyanhwebpro']
    },
    {
      id: 'wordpress-clean',
      name: 'WordPress sạch',
      theme: 'wordpress-default',
      plugins: ['duyanhwebpro']
    }
  ]
});

function safeJsonRead(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function atomicWrite(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(temp, file);
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolve(hash.digest('hex')));
  });
}

function readZipIndex(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('Package ZIP không tồn tại.');
  if (stat.size < 22 || stat.size > MAX_PACKAGE_BYTES) throw new Error('Package ZIP có dung lượng không hợp lệ.');
  const tailSize = Math.min(stat.size, 0xffff + 22 + 1024);
  const fd = fs.openSync(file, 'r');
  try {
    const tail = Buffer.alloc(tailSize);
    fs.readSync(fd, tail, 0, tail.length, stat.size - tailSize);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Không tìm thấy ZIP central directory.');
    const totalEntries = tail.readUInt16LE(eocd + 10);
    const centralSize = tail.readUInt32LE(eocd + 12);
    const centralOffset = tail.readUInt32LE(eocd + 16);
    if (totalEntries > 30000 || centralSize > 32 * 1024 * 1024) throw new Error('Package ZIP vượt giới hạn an toàn.');
    const central = Buffer.alloc(centralSize);
    fs.readSync(fd, central, 0, central.length, centralOffset);
    const entries = [];
    const names = new Set();
    let offset = 0;
    while (offset + 46 <= central.length && entries.length < totalEntries) {
      if (central.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP central directory không hợp lệ.');
      const compression = central.readUInt16LE(offset + 10);
      const compressedSize = central.readUInt32LE(offset + 20);
      const uncompressedSize = central.readUInt32LE(offset + 24);
      const nameLen = central.readUInt16LE(offset + 28);
      const extraLen = central.readUInt16LE(offset + 30);
      const commentLen = central.readUInt16LE(offset + 32);
      const externalAttrs = central.readUInt32LE(offset + 38);
      const localOffset = central.readUInt32LE(offset + 42);
      const nameStart = offset + 46;
      const nameEnd = nameStart + nameLen;
      if (nameEnd > central.length) throw new Error('ZIP entry bị cắt ngắn.');
      const name = central.subarray(nameStart, nameEnd).toString('utf8').replace(/\\/g,'/');
      if (!name || name.startsWith('/') || name.includes('\0') || name.split('/').some(part => part === '..')) {
        throw new Error(`ZIP chứa đường dẫn không an toàn: ${name || '(trống)'}`);
      }
      const mode = (externalAttrs >>> 16) & 0xffff;
      if ((mode & 0o170000) === 0o120000) throw new Error(`ZIP không chấp nhận symbolic link: ${name}`);
      const key = name.toLowerCase();
      if (names.has(key)) throw new Error(`ZIP có entry trùng: ${name}`);
      names.add(key);
      entries.push({ name, compression, compressedSize, uncompressedSize, localOffset });
      offset = nameEnd + extraLen + commentLen;
    }
    if (!entries.length) throw new Error('Package ZIP không có file.');
    return entries;
  } finally {
    fs.closeSync(fd);
  }
}

function readZipEntries(file) {
  return readZipIndex(file).map(item => item.name);
}

function readZipEntry(file, entryName, maxBytes = 2 * 1024 * 1024) {
  const item = readZipIndex(file).find(entry => entry.name.toLowerCase() === String(entryName).toLowerCase());
  if (!item) throw new Error(`ZIP thiếu entry: ${entryName}`);
  if (item.uncompressedSize > maxBytes) throw new Error(`ZIP entry quá lớn: ${entryName}`);
  const fd = fs.openSync(file,'r');
  try {
    const header = Buffer.alloc(30);
    fs.readSync(fd,header,0,header.length,item.localOffset);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new Error('ZIP local header không hợp lệ.');
    const nameLen = header.readUInt16LE(26);
    const extraLen = header.readUInt16LE(28);
    const dataOffset = item.localOffset + 30 + nameLen + extraLen;
    const compressed = Buffer.alloc(item.compressedSize);
    fs.readSync(fd,compressed,0,compressed.length,dataOffset);
    let output;
    if (item.compression === 0) output = compressed;
    else if (item.compression === 8) output = zlib.inflateRawSync(compressed);
    else throw new Error(`ZIP compression method chưa hỗ trợ: ${item.compression}`);
    if (output.length !== item.uncompressedSize || output.length > maxBytes) throw new Error('ZIP entry size không khớp.');
    return output;
  } finally {
    fs.closeSync(fd);
  }
}

function detectThemeRoot(entries) {
  const styleEntries = entries.filter(name => /^[^/]+\/style\.css$/i.test(name));
  if (styleEntries.length !== 1) throw new Error('Theme ZIP phải có đúng một thư mục gốc chứa style.css.');
  return styleEntries[0].split('/')[0];
}

function createFreshInstallPackageService(app) {
  const root = path.join(app.getPath('userData'), 'fresh-install-packages');
  const indexFile = path.join(root, 'index.json');

  function readIndex() {
    const raw = safeJsonRead(indexFile, { schema:PACKAGE_SCHEMA, packages:[] });
    const packages = Array.isArray(raw.packages) ? raw.packages : [];
    return { schema:PACKAGE_SCHEMA, packages };
  }

  function writeIndex(index) {
    atomicWrite(indexFile, { schema:PACKAGE_SCHEMA, packages:Array.isArray(index.packages) ? index.packages : [] });
  }

  function list() {
    const index = readIndex();
    return index.packages.filter(item => {
      try { return fs.statSync(item.path).isFile(); } catch { return false; }
    }).map(item => ({ ...item, path:undefined, available:true }));
  }

  function find(id, version = '') {
    const index = readIndex();
    const matches = index.packages.filter(item => item.id === id && (!version || item.version === version));
    const selected = matches.sort((a,b) => String(b.imported_at).localeCompare(String(a.imported_at)))[0];
    if (!selected) return null;
    try {
      if (!fs.statSync(selected.path).isFile()) return null;
      return { ...selected };
    } catch {
      return null;
    }
  }

  async function importTheme(filePath, options = {}) {
    const resolved = path.resolve(String(filePath || ''));
    if (!resolved.toLowerCase().endsWith('.zip')) throw new Error('Chỉ hỗ trợ theme dạng ZIP.');
    const entries = readZipEntries(resolved);
    const rootSlug = detectThemeRoot(entries);
    const styleText = readZipEntry(resolved, `${rootSlug}/style.css`, 1024 * 1024).toString('utf8');
    const detectedVersion = String(styleText.match(/^\s*Version\s*:\s*([^\r\n]+)/mi)?.[1] || '').trim();
    const id = String(options.id || rootSlug).trim().toLowerCase();
    const requestedVersion = String(options.version || '').trim();
    if (id === 'bricks' && requestedVersion && detectedVersion !== requestedVersion) {
      throw new Error(`ZIP Bricks không đúng version ${requestedVersion} (phát hiện: ${detectedVersion || 'không rõ'}).`);
    }
    const version = requestedVersion || detectedVersion || 'custom';
    if (!/^[a-z0-9][a-z0-9._-]{0,95}$/.test(id)) throw new Error('Theme slug không hợp lệ.');
    if (id === 'bricks' && rootSlug.toLowerCase() !== 'bricks') throw new Error('ZIP Bricks phải có thư mục gốc bricks/.');
    const digest = await sha256File(resolved);
    await fsp.mkdir(root, { recursive:true });
    const target = path.join(root, `${id}-${version}-${digest.slice(0,12)}.zip`);
    if (!fs.existsSync(target)) await fsp.copyFile(resolved, target);
    const stat = await fsp.stat(target);
    const index = readIndex();
    index.packages = index.packages.filter(item => !(item.id === id && item.version === version && item.sha256 === digest));
    const record = {
      id,
      kind:'theme',
      source:'managed',
      version,
      slug:rootSlug,
      path:target,
      sha256:digest,
      bytes:stat.size,
      expected_entry:`${rootSlug}/style.css`,
      imported_at:new Date().toISOString()
    };
    index.packages.push(record);
    writeIndex(index);
    return { ...record, path:undefined, available:true };
  }

  function resolveTheme(selection = {}) {
    const themeId = String(selection.id || 'bricks');
    if (themeId === 'wordpress-default') {
      return { id:'wordpress-default', source:'wordpress-core', version:'latest', active_theme:'' };
    }
    if (themeId === 'bricks') {
      const version = String(selection.version || '2.4');
      const pkg = find('bricks', version);
      return {
        id:'bricks',
        source:'managed',
        version,
        latest_stable:'2.4',
        active_theme:'bricks-child',
        generated_child:'bricks-child',
        package:pkg ? {
          id:pkg.id, version:pkg.version, slug:pkg.slug, path:pkg.path,
          sha256:pkg.sha256, bytes:pkg.bytes, expected_entry:pkg.expected_entry
        } : null
      };
    }
    const pkg = find(themeId, String(selection.version || ''));
    if (!pkg) throw new Error(`Chưa có package theme: ${themeId}`);
    return {
      id:pkg.id,
      source:'managed',
      version:pkg.version,
      active_theme:pkg.slug,
      generated_child:'',
      package:{
        id:pkg.id, version:pkg.version, slug:pkg.slug, path:pkg.path,
        sha256:pkg.sha256, bytes:pkg.bytes, expected_entry:pkg.expected_entry
      }
    };
  }

  function catalog() {
    const bricks = find('bricks','2.4');
    return {
      ...DEFAULT_CATALOG,
      package_library:list(),
      readiness:{
        bricks_2_4:!!bricks,
        bricks_2_4_sha256:bricks?.sha256 || '',
        bricks_2_4_bytes:bricks?.bytes || 0
      }
    };
  }

  return { catalog, list, find, importTheme, resolveTheme, root };
}

module.exports = {
  DEFAULT_CATALOG,
  createFreshInstallPackageService,
  readZipEntries,
  readZipEntry,
  detectThemeRoot,
  sha256File
};