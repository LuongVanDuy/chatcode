const fs = require('fs');

const file = 'core/owner-resolver.js';
let source = fs.readFileSync(file,'utf8');
const old = `function relatedCssOwner(rows, inspect, request, flags, facts = {}) {
  const tokens = requestTokens(request).filter(token => !['css','style','spacing','padding','margin','layout','responsive','product','products','card','cards','sản','phẩm','san','pham'].includes(token));
  const childRoot = norm(facts.child_theme_root || '').toLowerCase();
  const ranked = rows.filter(row => /\\.(?:css|scss|sass|less)$/i.test(row.path)).map(row => {
    const relation = directRelationEvidence(row,rows,inspect);
    let score = relation.length * 100;
    if (childRoot && row.lower.startsWith(childRoot)) score += 20;
    for (const token of tokens) {
      if (row.lower.includes(token)) score += 10;
      if (row.content.toLowerCase().includes(token)) score += 2;
    }
    if (/\\/(?:main|global|base|style)\\.css$/i.test(row.lower) && !flags.globalStyle && !relation.length) score -= 15;
    return { row, relation, score };
  }).filter(item => item.score >= 40).sort((a,b) => b.score - a.score || a.row.index - b.row.index);
  return ranked[0] || null;
}`;

const replacement = `function cssTargetAffinity(row, rows, flags) {
  const haystack = \`${'${row.lower}'}\\n${'${row.content}'}\`.toLowerCase();
  const basename = String(row.path.split('/').pop() || '').toLowerCase();
  let scoped = false, score = 0;

  if (flags.homepage) {
    scoped = true;
    if (/(?:^|[\\/_-])(?:home|homepage|front-page)(?:[\\/_.-]|$)|home[-_]?hero/.test(haystack)) score += 120;
    for (const source of rows) {
      if (!source.content || !source.content.toLowerCase().includes(basename)) continue;
      if (/\\b(?:is_front_page|is_home)\\s*\\(/i.test(source.content)) score += 160;
    }
  }
  if (flags.header) {
    scoped = true;
    if (/header|site[-_]?nav|main[-_]?nav/.test(haystack)) score += 120;
  }
  if (flags.footer) {
    scoped = true;
    if (/footer|site[-_]?footer/.test(haystack)) score += 120;
  }
  if (flags.product || flags.productCard) {
    scoped = true;
    if (/product|products|catalog|catalogue|san[-_]?pham|sản[-_]?phẩm/.test(haystack)) score += 120;
  }
  return { scoped, score };
}

function relatedCssOwner(rows, inspect, request, flags, facts = {}) {
  const tokens = requestTokens(request).filter(token => !['css','style','spacing','padding','margin','layout','responsive','product','products','card','cards','sản','phẩm','san','pham'].includes(token));
  const childRoot = norm(facts.child_theme_root || '').toLowerCase();
  const ranked = rows.filter(row => /\\.(?:css|scss|sass|less)$/i.test(row.path)).map(row => {
    const relation = directRelationEvidence(row,rows,inspect);
    const affinity = cssTargetAffinity(row,rows,flags);
    if (affinity.scoped && affinity.score === 0) return { row, relation, score:-1 };
    let score = relation.length * 100 + affinity.score;
    if (childRoot && row.lower.startsWith(childRoot)) score += 20;
    for (const token of tokens) {
      if (row.lower.includes(token)) score += 10;
      if (row.content.toLowerCase().includes(token)) score += 2;
    }
    if (/\\/(?:main|global|base|style)\\.css$/i.test(row.lower) && !flags.globalStyle && !relation.length) score -= 15;
    return { row, relation, score };
  }).filter(item => item.score >= 40).sort((a,b) => b.score - a.score || a.row.index - b.row.index);
  return ranked[0] || null;
}`;

if (!source.includes(old)) throw new Error('Owner relatedCssOwner block changed; aborting patch.');
source = source.replace(old,replacement);
fs.writeFileSync(file,source);
