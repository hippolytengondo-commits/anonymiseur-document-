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

/* ---- Adresses et numéros (siège social, domicile, factures, billets, comptes, séries…) ---- */
const AN = {
  fr: { text: "Alpha Conseil SARL, dont le siège social est situé au 15, Avenue du Commerce, Commune de la Gombe, Kinshasa, République Démocratique du Congo, représentée par Monsieur Paul Dupont, demeurant à Rue des Exemples 12, 1000 Bruxelles. Facture n° FAC-2030-0042, dossier 2030/0042, billet 1251234567890, compte 00123456789012, numéro de série SN-AB12345, BP 1234 Kinshasa 1.",
    hide: ['Avenue du Commerce', 'Commune de la Gombe', 'Rue des Exemples', '1000 Bruxelles', 'FAC-2030-0042', '2030/0042', '1251234567890', '00123456789012', 'SN-AB12345', 'BP 1234'], keep: ['siège social est situé', 'représentée par', 'Facture n°', 'numéro de série'] },
  en: { text: "Alpha Consulting Ltd, having its registered office at 221 Baker Street, London NW1 6XE, United Kingdom, is represented by Mr John Example, residing at 10 Example Road, Exampletown, EX1 2MP. Invoice No. INV-2030-0042, Order 123456789, Ticket 0161234567890, Account Number 12345678, Serial No. SN123456, PO Box 1234.",
    hide: ['221 Baker Street', 'NW1 6XE', '10 Example Road', 'EX1 2MP', 'INV-2030-0042', '123456789', '0161234567890', '12345678', 'SN123456', 'PO Box 1234'], keep: ['is represented by', 'Invoice No.', 'Serial No.'] },
  es: { text: "Alfa Consultoría S.L., con domicilio social en Calle de Ejemplo 12, 28001 Madrid, España, representada por D. Juan Ejemplo, residente en Avenida de la Constitución, 5, 2º B, Sevilla. Factura nº 2030-0042, Expediente 12345/2030, Póliza 000123456, Boleto 0012345678901.",
    hide: ['Calle de Ejemplo', '28001 Madrid', 'Avenida de la Constitución', 'Sevilla', '2030-0042', '12345/2030', '000123456', '0012345678901'], keep: ['representada por', 'Factura nº', 'Boleto'] },
  pt: { text: "Alfa Consultoria Ltda., com sede na Rua Exemplo, 123, Bairro Centro, São Paulo - SP, CEP 01000-000, Brasil. Fatura nº 2030-0042, Processo 0001234-56.2030.8.26.0000, Apólice 000123456.",
    hide: ['Rua Exemplo', 'Bairro Centro', 'São Paulo', '01000-000', '2030-0042', '0001234-56.2030.8.26.0000', '000123456'], keep: ['Fatura nº', 'Apólice'] },
  de: { text: "Alpha Beratung GmbH mit Sitz in der Beispielstraße 12, 10115 Berlin, vertreten durch Herr Hans Beispiel, wohnhaft in Hauptstraße 5, 80331 München. Rechnungsnummer RE-2030-0042, Kundennummer 123456, Seriennummer SN-9876543. Postfach 1234.",
    hide: ['Beispielstraße', '10115 Berlin', 'Hauptstraße', '80331 München', 'RE-2030-0042', '123456', 'SN-9876543', 'Postfach 1234'], keep: ['vertreten durch', 'Rechnungsnummer', 'Seriennummer'] },
  ru: { text: "Юридический адрес: 123456, г. Москва, ул. Примерная, д. 1, стр. 2, оф. 3. Проживающий по адресу: г. Санкт-Петербург, пр. Примерный, д. 5, кв. 7. Счёт № 40702810000000000000, договор № 12/2030, билет 1234567890123, серийный номер AB-123456.",
    hide: ['Москва', 'Примерная', 'Санкт-Петербург', 'Примерный', '40702810000000000000', '12/2030', '1234567890123', 'AB-123456'], keep: ['Юридический адрес', 'Проживающий по адресу', 'серийный номер'] },
  zh: { text: "注册地址：北京市朝阳区建国路88号8层801室。联系地址：上海市浦东新区示例路100号。发票号码：FP2030004200，合同编号：HT-2030-0042，订单号：0012345678，序列号：SN123456。",
    hide: ['北京市朝阳区建国路88号', '上海市浦东新区示例路100号', 'FP2030004200', 'HT-2030-0042', '0012345678', 'SN123456'], keep: ['注册地址', '发票号码', '序列号'] }
};
for (const [lang, a] of Object.entries(AN)) {
  ok(`adresses et numéros masqués : ${lang}`, () => {
    const det = E.detect(a.text, ALL);
    const types = new Set(det.map(d => d.type));
    assert.ok(types.has('address') && types.has('number'), 'types détectés : ' + [...types].join(','));
    const cnt = {};
    const items = det.filter(d => d.conf === 'high' || d.type === 'phone').map(d => { cnt[d.type] = (cnt[d.type] || 0) + 1; return { variants: d.variants, repl: E.formatLabel(d.type, cnt[d.type], lang) }; });
    const anon = E.applyMatches(a.text, E.buildMatcher(items).fn(a.text));
    const left = a.hide.filter(h => anon.includes(h));
    assert.deepStrictEqual(left, [], 'restent : ' + left.join(' | ') + '\n  texte : ' + anon);
    const lost = a.keep.filter(k => !anon.includes(k));
    assert.deepStrictEqual(lost, [], 'texte courant masqué à tort : ' + lost.join(' | ') + '\n  texte : ' + anon);
    const back = E.applyMatches(anon, E.buildMatcher(items.map(i => ({ variants: [i.repl], repl: i.variants[0] }))).fn(anon));
    for (const h of a.hide) assert.ok(back.includes(h), 'non restauré : ' + h);
  });
}
ok('adresses : chaque adresse est un seul élément (pas de fragments)', () => {
  const det = E.detect(AN.fr.text, ALL).filter(d => d.type === 'address');
  assert.strictEqual(det.length, 3, JSON.stringify(det.map(d => d.variants)));
});
ok('adresses : mention ultérieure de la rue seule, sans libellé', () => {
  const t = "Siège social : 15 avenue du Commerce, Gombe, Kinshasa. Les réunions se tiennent au 15 avenue du Commerce.";
  const det = E.detect(t, ALL).filter(d => d.type === 'address');
  const items = det.map((d, i) => ({ variants: d.variants, repl: '<ADR' + i + '>' }));
  const anon = E.applyMatches(t, E.buildMatcher(items).fn(t));
  assert.ok(!anon.includes('avenue du Commerce'), anon);
});
ok('numéros : aucune détection à tort dans des textes courants (sept langues)', () => {
  const CLEAN = [
    "The parties agree that this Agreement shall be governed by the laws of England. Section 5 Termination. See Article 12 and Schedule 3. COVID-19 and ISO 9001 were discussed in 2030.",
    "Le présent contrat régit les droits et obligations des parties. Article 5. Durée du Contrat. Voir la page 45 et le paragraphe 3. Le délai est de 30 jours.",
    "El presente contrato regula los derechos y obligaciones de las partes. Artículo 5. Duración del Contrato. Véase la página 45.",
    "O presente contrato regula os direitos e obrigações das partes. Artigo 5. Duração do Contrato. Veja a página 45.",
    "Der Vertrag regelt die Rechte und Pflichten der Parteien. Jede Partei kann den Vertrag kündigen. Zahlungen erfolgen monatlich in 12 Raten.",
    "Настоящий договор регулирует права и обязанности сторон. Статья 5. Срок действия договора. См. страницу 45.",
    "本合同规定了双方的权利和义务。第五条合同期限。各方应承担各自的费用。"
  ];
  for (const t of CLEAN) {
    const d = E.detect(t, ALL).filter(x => x.type === 'address' || x.type === 'number');
    assert.deepStrictEqual(d.map(x => x.variants[0]), [], 'faux positif dans : ' + t.slice(0, 50));
  }
});
ok('options : adresses et numéros désactivables', () => {
  const d = E.detect(AN.fr.text, Object.assign({}, ALL, { address: false, number: false }));
  assert.ok(!d.some(x => x.type === 'address' || x.type === 'number'));
});
ok('désignations adresse et numéro dans les 7 langues', () => {
  for (const l of E.LANGS) { assert.ok(E.formatLabel('address', 1, l) !== E.formatLabel('org', 1, l)); assert.ok(E.formatLabel('number', 1, l)); }
  assert.strictEqual(E.formatLabel('address', 2), 'Adresse B');
  assert.strictEqual(E.formatLabel('number', 3, 'en'), '[NUMBER 3]');
});
ok('un nom de personne ou de société ne déborde pas sur la ligne suivante', () => {
  const t = 'Signature de Monsieur Paul Dupont — Madame Anne Martin\nLigne de remplissage pour Alpha Conseil\nSARL";\nProjet Soleil';
  const det = E.detect(t, ALL);
  const all = det.flatMap(d => d.variants);
  assert.ok(!all.some(v => /\n/.test(v)), 'variante sur deux lignes : ' + JSON.stringify(all));
  assert.ok(!all.includes('Ligne') && !all.includes('Projet'), 'mot de la ligne suivante absorbé : ' + JSON.stringify(all));
  assert.ok(all.includes('Anne Martin') && all.includes('Paul Dupont'));
});
console.log(`${n} tests réussis, ${bad} échec(s)`);
process.exit(bad ? 1 : 0);
