const E = require('../src/engine.js');
const fs = require('fs');
(async () => {
  const buf = fs.readFileSync('test/demo.docx');
  const ents = await E.unzip(buf);
  const text = E.docxPartsText(ents);
  console.log('--- TEXTE EXTRAIT ---\n' + text + '\n');
  const det = E.detect(text, { amount: true, date: true });
  console.log('--- DETECTION ---');
  for (const d of det) console.log(d.type, d.conf, JSON.stringify(d.variants));
  // simuler le comportement de l'interface : labels par ordre d'apparition
  const cnt = {}; const items = det.filter(d => d.conf === 'high' || d.type==='person').sort((a,b)=>a.first-b.first).map(d => { cnt[d.type]=(cnt[d.type]||0)+1; return { variants: d.variants, repl: E.formatLabel(d.type, cnt[d.type]) }; });
  const m = E.buildMatcher(items);
  const out = E.transformDocx(ents, m.fn, { scrub: true });
  const bytes = E.zip(out);
  fs.writeFileSync('test/anon.docx', bytes);
  const again = await E.unzip(bytes);
  const t2 = E.docxPartsText(again);
  console.log('\n--- ANONYMISÉ ---\n' + t2);
  // restauration
  const rev = items.map(i => ({ variants: [i.repl], repl: i.variants[0] }));
  const back = E.transformDocx(again, E.buildMatcher(rev).fn, {});
  fs.writeFileSync('test/restored.docx', E.zip(back));
  console.log('\n--- RESTAURÉ ---\n' + E.docxPartsText(await E.unzip(E.zip(back))));
  console.log('\n--- RÉSIDUEL ---', E.residualWords(t2, new Set(['personne','société']), 20).map(s=>s.word+':'+s.total).join(', '));
})();
