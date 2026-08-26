const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'assets');
fs.mkdirSync(assets, { recursive: true });

for (const name of ['icon.png', 'icon.ico']) {
  const source = path.join(assets, `${name}.b64`);
  const target = path.join(assets, name);
  const encoded = fs.readFileSync(source, 'utf8').replace(/\s+/g, '');
  fs.writeFileSync(target, Buffer.from(encoded, 'base64'));
}

console.log('Generated native ChatCode icons.');
