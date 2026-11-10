const fs = require('fs');
let t = fs.readFileSync('src/template.html', 'utf8');
const rd = f => fs.readFileSync(f, 'utf8');
const libs = { PDFJS: rd('vendor/pdf.min.mjs'), WORKER: rd('vendor/pdf.worker.min.mjs'), PDFLIB: rd('vendor/pdf-lib.min.js') };
const engine = rd('src/engine.js'), app = rd('src/app.js');
for (const [k, v] of Object.entries({ ...libs, ENGINE: engine, APP: app })) {
  if (/<\/script|<!--/i.test(v)) throw new Error('Séquence interdite dans ' + k);
  t = t.replace('/*@@' + k + '@@*/', () => v);
}
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/anonymiseur.html', t);
fs.writeFileSync('index.html', t);
console.log('OK', (t.length / 1024 / 1024).toFixed(2) + ' Mo');
