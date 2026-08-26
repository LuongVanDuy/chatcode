const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
const vendor = path.join(root, 'renderer', 'vendor');
fs.mkdirSync(assets, { recursive: true });
fs.mkdirSync(vendor, { recursive: true });

// Vector master based on Lucide's CodeXml geometry. Rendering from SVG removes
// the blurry/broken raster artifact that older ChatCode builds used.
const brandSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="28" y1="18" x2="222" y2="238" gradientUnits="userSpaceOnUse">
      <stop stop-color="#2563EB"/>
      <stop offset="1" stop-color="#1D4ED8"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0F172A" flood-opacity="0.18"/>
    </filter>
  </defs>
  <rect x="18" y="18" width="220" height="220" rx="54" fill="url(#bg)" filter="url(#shadow)"/>
  <path d="M86 88 48 128l38 40" fill="none" stroke="#fff" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m170 88 38 40-38 40" fill="none" stroke="#fff" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="m145 62-34 132" fill="none" stroke="#DBEAFE" stroke-width="15" stroke-linecap="round"/>
</svg>`;

function makeIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(0, 6); // 256px
  header.writeUInt8(0, 7); // 256px
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

function copyLucideRuntime() {
  const entry = require.resolve('lucide');
  const dist = path.resolve(path.dirname(entry), '..');
  const candidates = [path.join(dist, 'umd', 'lucide.js'), path.join(dist, 'umd', 'lucide.min.js')];
  const source = candidates.find(file => fs.existsSync(file));
  if (!source) throw new Error(`Không tìm thấy Lucide UMD runtime từ ${entry}`);
  fs.copyFileSync(source, path.join(vendor, 'lucide.js'));
}

async function main() {
  const pngPath = path.join(assets, 'icon.png');
  await sharp(Buffer.from(brandSvg)).resize(256, 256).png({ compressionLevel: 9 }).toFile(pngPath);
  const png = fs.readFileSync(pngPath);
  fs.writeFileSync(path.join(assets, 'icon.ico'), makeIco(png));
  fs.writeFileSync(path.join(assets, 'brand.svg'), brandSvg.trim() + '\n', 'utf8');
  copyLucideRuntime();
  console.log('Generated crisp app icon + local Lucide SVG runtime.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
