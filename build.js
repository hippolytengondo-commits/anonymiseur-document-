const fs = require('fs');
let t = fs.readFileSync('src/template.html', 'utf8');
const rd = f => fs.readFileSync(f, 'utf8');
const libs = { PDFJS: rd('vendor/pdf.min.mjs'), WORKER: rd('vendor/pdf.worker.min.mjs'), PDFLIB: rd('vendor/pdf-lib.min.js') };
const engine = rd('src/engine.js'), app = rd('src/app.js');
for (const [k, v] of Object.entries({ ...libs, ENGINE: engine, APP: app })) {
  if (/<\/script|<!--/i.test(v)) throw new Error('Séquence interdite dans ' + k);
  t = t.replace('/*@@' + k + '@@*/', () => v);
}
const icon = n => 'data:image/png;base64,' + fs.readFileSync('src/icons/icon-' + n + '.png').toString('base64');
const fill = x => x.replace(/@@ICON(180|192|512)@@/g, (m, n) => icon(n));
t = fill(t);
const version = require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 12);
const manifest = fill(rd('src/manifest.webmanifest'));
const sw = rd('src/sw.js').replace('@@VERSION@@', version);
fs.mkdirSync('dist', { recursive: true });
for (const d of ['dist/', '']) { fs.writeFileSync(d + 'manifest.webmanifest', manifest); fs.writeFileSync(d + 'sw.js', sw); }
fs.writeFileSync('dist/anonymiseur.html', t);
fs.writeFileSync('index.html', t);
console.log('OK', (t.length / 1024 / 1024).toFixed(2) + ' Mo');
