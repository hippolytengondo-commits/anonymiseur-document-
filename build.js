const fs = require('fs');
const rd = f => fs.readFileSync(f, 'utf8');
let t = rd('src/template.html');

/* --- Vérification des traductions : chaque clé utilisée existe en FR et en EN --- */
const { I18N_DATA } = require('./src/i18n.js');
const known = new Set(I18N_DATA.map(r => r[0]));
const dup = I18N_DATA.map(r => r[0]).filter((k, i, a) => a.indexOf(k) !== i);
if (dup.length) throw new Error('Clés de traduction en double : ' + dup.join(', '));
const used = new Set();
for (const m of t.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([\w.]+)"/g)) used.add(m[1]);
for (const f of ['src/app.js', 'src/ui.js']) {
  for (const m of rd(f).matchAll(/\bt\('([\w.]+)'/g)) used.add(m[1]);
}
const E = require('./src/engine.js');
const need = [...Object.keys(E.TYPES).map(k => 'type.' + k), 'kind.pdf', 'kind.docx', 'kind.txt', 'status.table', 'status.none',
  'vault.none', 'vault.locked', 'vault.open', 'off.yes', 'off.no'];
for (const m of rd('src/ui.js').matchAll(/\{ id: '(\w+)', icon: '\w+'(?:, tab: '([\w.]+)')?/g)) { need.push('nav.' + m[1]); if (m[2]) need.push(m[2]); }
for (const f of ['src/app.js', 'src/ui.js', 'src/store.js']) for (const m of rd(f).matchAll(/logActivity\('(\w+)'/g)) need.push('ev.' + m[1]);
const missing = [...used, ...need].filter(k => !k.endsWith('.') && !known.has(k));
if (missing.length) throw new Error('Clés de traduction manquantes : ' + [...new Set(missing)].join(', '));
for (const [k, fr, en] of I18N_DATA) if (!fr || !en) throw new Error('Traduction vide : ' + k);

const libs = { PDFJS: rd('vendor/pdf.min.mjs'), WORKER: rd('vendor/pdf.worker.min.mjs'), PDFLIB: rd('vendor/pdf-lib.min.js') };
const code = { ENGINE: rd('src/engine.js'), I18N: rd('src/i18n.js'), STORE: rd('src/store.js'), APP: rd('src/app.js'), UI: rd('src/ui.js') };
for (const [k, v] of Object.entries({ ...libs, ...code })) {
  if (/<\/script|<!--/i.test(v)) throw new Error('Séquence interdite dans ' + k);
  t = t.replace('/*@@' + k + '@@*/', () => v);
}
const png = n => 'data:image/png;base64,' + fs.readFileSync('src/icons/icon-' + n + '.png').toString('base64');
const webp = n => 'data:image/webp;base64,' + fs.readFileSync('src/brand/' + n + '.webp').toString('base64');
const fill = x => x
  .replace(/@@ICON(180|192|512)@@/g, (m, n) => png(n))
  .replace('@@LOGO_LOCKUP_TAG@@', () => webp('lockup-tagline'))
  .replace('@@LOGO_LOCKUP@@', () => webp('lockup'))
  .replace('@@LOGO_MARK@@', () => webp('mark'));
t = fill(t);
if (/@@(ICON|LOGO)/.test(t)) throw new Error('Jeton non remplacé dans le gabarit');
const version = require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 12);
const manifest = fill(rd('src/manifest.webmanifest'));
const sw = rd('src/sw.js').replace('@@VERSION@@', version);
fs.mkdirSync('dist', { recursive: true });
for (const d of ['dist/', '']) { fs.writeFileSync(d + 'manifest.webmanifest', manifest); fs.writeFileSync(d + 'sw.js', sw); }
fs.writeFileSync('dist/anonymiseur.html', t);
fs.writeFileSync('index.html', t);
console.log('OK', (t.length / 1024 / 1024).toFixed(2) + ' Mo —', known.size, 'clés FR/EN, version', version);
