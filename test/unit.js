'use strict';
// Tests unitaires (Node) : traductions, export CSV, désignations, aller-retour du moteur. Données fictives uniquement.
const assert = require('assert');
const E = require('../src/engine.js');
const { I18N_DATA } = require('../src/i18n.js');
const { csvCell } = require('../src/store.js');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('OK  ', name); };

ok('traductions : clés uniques, FR et EN renseignés', () => {
  const keys = I18N_DATA.map(r => r[0]);
  assert.strictEqual(new Set(keys).size, keys.length);
  for (const [k, fr, en] of I18N_DATA) { assert.ok(fr && en, k); const a = (fr.match(/\{\w+\}/g) || []).sort().join(), b = (en.match(/\{\w+\}/g) || []).sort().join(); assert.strictEqual(a, b, 'variables différentes : ' + k); }
});
ok('désignations françaises et anglaises', () => {
  assert.strictEqual(E.formatLabel('org', 1), 'Société A');
  assert.strictEqual(E.formatLabel('org', 2, 'en'), 'Company B');
  assert.strictEqual(E.formatLabel('person', 27), 'Personne AA');
  assert.strictEqual(E.formatLabel('email', 1, 'en'), '[EMAIL 1]');
  assert.strictEqual(E.formatLabel('email', 1), '[E-MAIL 1]');
});
ok('CSV : neutralisation des formules, numéros de téléphone conservés', () => {
  assert.strictEqual(csvCell('=1+1'), '"\'=1+1"');
  assert.strictEqual(csvCell('@SOMME(A1)'), '"\'@SOMME(A1)"');
  assert.strictEqual(csvCell('-2+3+cmd|calc'), '"\'-2+3+cmd|calc"');
  assert.strictEqual(csvCell('+243 80 000 0000'), '"+243 80 000 0000"');
  assert.strictEqual(csvCell('Alpha "Conseil"'), '"Alpha ""Conseil"""');
  assert.strictEqual(csvCell('1 000 000 USD'), '"1 000 000 USD"');
});
ok('moteur : anonymisation puis restauration (texte fictif)', () => {
  const text = 'Entre Alpha Conseil SARL, représentée par Monsieur Paul Dupont, et Beta Industries SA. Contact : contact@alpha-exemple.test.';
  const det = E.detect(text, { org: true, person: true, email: true, phone: true, id: true, iban: true, url: true });
  const cnt = {};
  const items = det.filter(d => d.conf === 'high').map(d => { cnt[d.type] = (cnt[d.type] || 0) + 1; return { variants: d.variants, repl: E.formatLabel(d.type, cnt[d.type]) }; });
  const m = E.buildMatcher(items);
  const anon = E.applyMatches(text, m.fn(text));
  for (const w of ['Alpha', 'Dupont', 'Beta Industries', 'alpha-exemple']) assert.ok(!anon.includes(w), 'identité restante : ' + w);
  const back = E.applyMatches(anon, E.buildMatcher(items.map(i => ({ variants: [i.repl], repl: i.variants[0] }))).fn(anon));
  for (const w of ['Alpha Conseil SARL', 'Paul Dupont', 'Beta Industries SA', 'contact@alpha-exemple.test']) assert.ok(back.includes(w), 'non restauré : ' + w);
  assert.ok(!/Société [A-Z]|Personne [A-Z]|\[E-MAIL/.test(back));
});
console.log(n + ' tests unitaires réussis');
