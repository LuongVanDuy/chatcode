const fs = require('fs');
const file = 'renderer/v10-runtime.js';
let text = fs.readFileSync(file, 'utf8');
const marker = 'await render(); await refreshTerminalJobs();';
const count = text.split(marker).length - 1;
if (count < 2) throw new Error(`Expected at least two inline render/refresh sequences, got ${count}`);
text = text.split(marker).join('await render();\n    await refreshTerminalJobs();');
fs.writeFileSync(file, text, 'utf8');
console.log(`Normalized ${count} render/refresh sequences.`);
