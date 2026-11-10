'use strict';
// Détection multilingue (fr, en, es, pt, de, ru, zh) — documents entièrement fictifs.
const assert = require('assert');
const E = require('../src/engine.js');
const ALL = { org: true, person: true, email: true, phone: true, id: true, iban: true, url: true, amount: true, date: true };
let n = 0, bad = 0;
const ok = (name, fn) => { try { fn(); n++; console.log('OK  ', name); } catch (e) { bad++; console.log('FAIL', name, '\n     ', e.message.split('\n').join('\n      ')); } };

const SAMPLES = {
  fr: {
    text: "Entre la société Alpha Conseil SARL, représentée par Monsieur Paul Dupont, et Beta Industries SA, le 5 janvier 2030. Contact : paul@alpha-exemple.test, tél. +243 80 000 0000. Montant : 1 000 000 USD. Cabinet Exemple & Associés.",
    hide: ['Alpha Conseil', 'Paul Dupont', 'Dupont', 'Beta Industries', 'paul@alpha-exemple.test', '+243 80 000 0000', '1 000 000 USD', '5 janvier 2030'],
    types: ['org', 'person', 'email', 'phone', 'amount', 'date']
  },
  en: {
    text: "This Agreement is made on January 5, 2030 between Alpha Consulting Ltd, represented by Mr. John Example, and Beta Industries LLC. Contact: john@alpha-example.test, phone +44 20 7946 0000. Amount: $1,500,000. Signed at the University of Exampleton. Passport No. X0000000.",
    hide: ['Alpha Consulting', 'John Example', 'Beta Industries', 'john@alpha-example.test', '+44 20 7946 0000', '$1,500,000', 'January 5, 2030', 'University of Exampleton', 'X0000000'],
    types: ['org', 'person', 'email', 'phone', 'amount', 'date', 'id']
  },
  es: {
    text: "El presente contrato se celebra el 5 de enero de 2030 entre Alfa Consultoría S.L., representada por el Sr. Juan Ejemplo García, y Beta Industrias S.A. de C.V. DNI 00000000T. Correo: juan@alfa-ejemplo.test. Teléfono +34 600 000 000. Importe: 1.500.000 euros. Fundación Ejemplo del Sur.",
    hide: ['Alfa Consultoría', 'Juan Ejemplo García', 'Beta Industrias', '00000000T', 'juan@alfa-ejemplo.test', '+34 600 000 000', '1.500.000 euros', '5 de enero de 2030', 'Fundación Ejemplo del Sur'],
    types: ['org', 'person', 'email', 'phone', 'amount', 'date', 'id']
  },
  pt: {
    text: "O presente contrato é celebrado em 5 de janeiro de 2030 entre Alfa Consultoria Ltda., representada pelo Sr. João Exemplo Silva, e Beta Indústria S.A. CPF 000.000.000-00, CNPJ 00.000.000/0001-00. E-mail: joao@alfa-exemplo.test. Telefone +55 11 90000-0000. Valor: R$ 1.500.000,00. Fundação Exemplo do Sul.",
    hide: ['Alfa Consultoria', 'João Exemplo Silva', 'Beta Indústria', '000.000.000-00', '00.000.000/0001-00', 'joao@alfa-exemplo.test', 'R$ 1.500.000,00', '5 de janeiro de 2030', 'Fundação Exemplo do Sul'],
    types: ['org', 'person', 'email', 'amount', 'date', 'id']
  },
  de: {
    text: "Dieser Vertrag wird am 5. Januar 2030 zwischen der Alpha Beratung GmbH, vertreten durch Herr Hans Beispiel, und der Beta Industrie AG geschlossen. USt-IdNr. DE000000000, HRB 00000. E-Mail: hans@alpha-beispiel.test, Telefon +49 30 00000000. Betrag: 1.500.000 Euro. Stiftung Beispielland.",
    hide: ['Alpha Beratung', 'Hans Beispiel', 'Beta Industrie', 'DE000000000', 'HRB 00000', 'hans@alpha-beispiel.test', '+49 30 00000000', '1.500.000 Euro', '5. Januar 2030', 'Stiftung Beispielland'],
    types: ['org', 'person', 'email', 'phone', 'amount', 'date', 'id']
  },
  ru: {
    text: "Директор ООО «Альфа Консалтинг» Иван Иванович Примеров заключил договор с АО «Бета Индастриз» 5 января 2030 г. ИНН 0000000000, ОГРН 0000000000000. Контакт: ivan@alfa-primer.test, тел. +7 (495) 000-00-00. Сумма 1 500 000 рублей. Передано Примерову И.И.",
    hide: ['Альфа Консалтинг', 'Иван Иванович Примеров', 'Примеров', 'Примерову', 'Бета Индастриз', '0000000000', 'ivan@alfa-primer.test', '+7 (495) 000-00-00', '1 500 000 рублей', '5 января 2030 г'],
    types: ['org', 'person', 'email', 'phone', 'amount', 'date', 'id']
  },
  zh: {
    text: "本合同由北京阿尔法咨询有限公司（以下简称“甲方”）与张示例先生签订。法定代表人：李示例。联系电话：13800000000，邮箱：zhang@alpha-shili.test。合同金额：人民币100万元。统一社会信用代码：91000000000000000X。签订日期：2030年1月5日。身份证号：110101200001010000。",
    hide: ['北京阿尔法咨询有限公司', '张示例', '李示例', '13800000000', 'zhang@alpha-shili.test', '人民币100万元', '91000000000000000X', '2030年1月5日', '110101200001010000'],
    types: ['org', 'person', 'email', 'phone', 'amount', 'date', 'id']
  }
};

for (const [lang, s] of Object.entries(SAMPLES)) {
  ok(`langue détectée : ${lang}`, () => assert.strictEqual(E.detectLanguages(s.text)[0], lang));
  ok(`détection et masquage : ${lang}`, () => {
    const det = E.detect(s.text, ALL);
    const types = new Set(det.map(d => d.type));
    for (const t of s.types) assert.ok(types.has(t), 'type non détecté : ' + t + ' — détectés : ' + JSON.stringify(det.map(d => [d.type, d.variants[0]])));
    const cnt = {};
    const items = det.filter(d => d.conf === 'high' || d.type === 'phone').map(d => { cnt[d.type] = (cnt[d.type] || 0) + 1; return { variants: d.variants, repl: E.formatLabel(d.type, cnt[d.type], lang) }; });
    const anon = E.applyMatches(s.text, E.buildMatcher(items).fn(s.text));
    const left = s.hide.filter(h => anon.includes(h));
    assert.deepStrictEqual(left, [], 'identités restantes : ' + left.join(' | ') + '\n  texte : ' + anon + '\n  détections : ' + JSON.stringify(det.map(d => [d.type, d.conf, d.variants])));
    // restauration
    const back = E.applyMatches(anon, E.buildMatcher(items.map(i => ({ variants: [i.repl], repl: i.variants[0] }))).fn(anon));
    assert.ok(!/【|Лицо [A-Z]|Persona [A-Z]|Pessoa [A-Z]/.test(back), 'désignation non restaurée : ' + back);
  });
}
ok('désignations dans les 7 langues', () => {
  for (const l of E.LANGS) { const a = E.formatLabel('org', 1, l), b = E.formatLabel('email', 2, l); assert.ok(a && b && a !== b); }
  assert.strictEqual(E.formatLabel('person', 2, 'es'), 'Persona B');
  assert.strictEqual(E.formatLabel('org', 1, 'zh'), '【公司A】');
});
ok('chinois : remplacement sans espaces et restauration', () => {
  const t = '与张示例先生签订合同，张示例同意。';
  const m = E.buildMatcher([{ variants: ['张示例'], repl: '【人员A】' }]);
  assert.strictEqual(E.applyMatches(t, m.fn(t)), '与【人员A】先生签订合同，【人员A】同意。');
});
ok('russe : déclinaisons des noms', () => {
  const t = 'Примеров подписал. Передано Примерову. Встреча с Примеровым.';
  const m = E.buildMatcher([{ variants: ['Примеров'], repl: 'Лицо A' }]);
  assert.strictEqual(E.applyMatches(t, m.fn(t)), 'Лицо A подписал. Передано Лицо A. Встреча с Лицо A.');
});
ok('aucun changement de comportement pour le français (texte inchangé hors identités)', () => {
  const t = 'Le contrat est signé à Kinshasa par Alpha Conseil SARL.';
  const det = E.detect(t, ALL);
  assert.deepStrictEqual(det.map(d => d.type), ['org']);
});
console.log(`${n} tests réussis, ${bad} échec(s)`);
process.exit(bad ? 1 : 0);
