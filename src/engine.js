'use strict';
/* ===== Moteur d'anonymisation — sans dépendance, 100 % local ===== */

const TYPES = {
  person: { name: 'Personne', base: 'Personne', style: 'letter' },
  org: { name: 'Société / organisation', base: 'Société', style: 'letter' },
  other: { name: 'Autre terme', base: 'Élément', style: 'letter' },
  email: { name: 'E-mail', base: 'E-MAIL', style: 'num' },
  phone: { name: 'Téléphone', base: 'TÉLÉPHONE', style: 'num' },
  id: { name: 'Identifiant (RCCM, NIF…)', base: 'IDENTIFIANT', style: 'num' },
  iban: { name: 'Compte bancaire', base: 'COMPTE', style: 'num' },
  url: { name: 'Lien web', base: 'LIEN', style: 'num' },
  amount: { name: 'Montant', base: 'MONTANT', style: 'num' },
  date: { name: 'Date', base: 'DATE', style: 'num' }
};
/* Désignations par langue (fr : TYPES ci-dessus) */
const TYPES_L = {
  en: { person: 'Person', org: 'Company', other: 'Item', email: 'EMAIL', phone: 'PHONE', id: 'ID', iban: 'ACCOUNT', url: 'LINK', amount: 'AMOUNT', date: 'DATE' },
  es: { person: 'Persona', org: 'Empresa', other: 'Elemento', email: 'CORREO', phone: 'TELÉFONO', id: 'IDENTIFICADOR', iban: 'CUENTA', url: 'ENLACE', amount: 'IMPORTE', date: 'FECHA' },
  pt: { person: 'Pessoa', org: 'Empresa', other: 'Elemento', email: 'E-MAIL', phone: 'TELEFONE', id: 'IDENTIFICADOR', iban: 'CONTA', url: 'LINK', amount: 'VALOR', date: 'DATA' },
  de: { person: 'Person', org: 'Unternehmen', other: 'Element', email: 'E-MAIL', phone: 'TELEFON', id: 'KENNUNG', iban: 'KONTO', url: 'LINK', amount: 'BETRAG', date: 'DATUM' },
  ru: { person: 'Лицо', org: 'Компания', other: 'Элемент', email: 'ПОЧТА', phone: 'ТЕЛЕФОН', id: 'НОМЕР', iban: 'СЧЁТ', url: 'ССЫЛКА', amount: 'СУММА', date: 'ДАТА' },
  zh: { person: '人员', org: '公司', other: '项目', email: '邮箱', phone: '电话', id: '编号', iban: '账户', url: '链接', amount: '金额', date: '日期' }
};
const TYPES_EN = TYPES_L.en;
function letters(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
function formatLabel(type, n, lang) {
  const t = TYPES[type] || TYPES.other;
  const base = lang && TYPES_L[lang] ? (TYPES_L[lang][type] || TYPES_L[lang].other) : t.base;
  if (lang === 'zh') return t.style === 'letter' ? `【${base}${letters(n)}】` : `【${base}${n}】`;
  return t.style === 'letter' ? `${base} ${letters(n)}` : `[${base} ${n}]`;
}

/* ---------- Archive ZIP (lecture / écriture) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function unzip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un document Word (.docx) valide.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const out = [];
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Archive corrompue.');
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lel;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (name.endsWith('/')) data = new Uint8Array(0);
    else if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new Error('Méthode de compression non prise en charge.');
    out.push({ name, data });
  }
  return out;
}
function zip(entries) {
  const enc = new TextEncoder();
  const chunks = [], central = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const e of entries) {
    const name = enc.encode(e.name), data = e.data, crc = crc32(data);
    const lh = new Uint8Array(30 + name.length), d = new DataView(lh.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x0800, true); d.setUint16(8, 0, true);
    d.setUint16(10, dosTime, true); d.setUint16(12, dosDate, true); d.setUint32(14, crc, true);
    d.setUint32(18, data.length, true); d.setUint32(22, data.length, true); d.setUint16(26, name.length, true); d.setUint16(28, 0, true);
    lh.set(name, 30);
    chunks.push(lh, data);
    const ch = new Uint8Array(46 + name.length), c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  let csize = 0;
  for (const c of central) csize += c.length;
  const end = new Uint8Array(22), ed = new DataView(end.buffer);
  ed.setUint32(0, 0x06054b50, true); ed.setUint16(8, entries.length, true); ed.setUint16(10, entries.length, true);
  ed.setUint32(12, csize, true); ed.setUint32(16, offset, true);
  chunks.push(...central, end);
  let total = 0;
  for (const c of chunks) total += c.length;
  const res = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { res.set(c, pos); pos += c.length; }
  return res;
}

/* ---------- XML Word ---------- */
const W_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/;
const XENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function xmlDecode(s) {
  return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-fA-F]+);/g,
    (m, n, d, h) => (n ? XENT['&' + n + ';'] : String.fromCodePoint(d ? +d : parseInt(h, 16))));
}
function xmlEncode(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function attrEncode(s) { return xmlEncode(s).replace(/"/g, '&quot;'); }

const TOKEN_RE = /<w:p(\s[^>]*?)?(\/?)>|<\/w:p>|<w:t(\s[^>]*?)?>([^<]*)<\/w:t>/g;
function paragraphsOf(xml) {
  const stack = [], done = [];
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(xml))) {
    const s = m[0];
    if (s === '</w:p>') { const g = stack.pop(); if (g) done.push(g); }
    else if (s.startsWith('<w:p')) { if (m[2] === '/') done.push({ tokens: [] }); else stack.push({ tokens: [] }); }
    else {
      const g = stack[stack.length - 1];
      if (g) g.tokens.push({ start: m.index, end: m.index + s.length, attrs: m[3] || '', text: xmlDecode(m[4]) });
    }
  }
  return done;
}
function paragraphTexts(xml) {
  return paragraphsOf(xml).filter(p => p.tokens.length)
    .sort((a, b) => a.tokens[0].start - b.tokens[0].start)
    .map(p => p.tokens.map(t => t.text).join(''));
}
function docxPartsText(entries) {
  const dec = new TextDecoder('utf-8'), out = [];
  for (const e of entries) if (W_PARTS.test(e.name)) out.push(...paragraphTexts(dec.decode(e.data)));
  return out.join('\n');
}
function rewriteXml(xml, matchFn) {
  const edits = [];
  for (const p of paragraphsOf(xml)) {
    if (!p.tokens.length) continue;
    let full = '';
    const ranges = [];
    for (const t of p.tokens) { ranges.push([full.length, full.length + t.text.length]); full += t.text; }
    const matches = matchFn(full);
    if (!matches.length) continue;
    p.tokens.forEach((t, i) => {
      const [a, b] = ranges[i];
      let out = '', pos = a;
      for (const m of matches) {
        if (m.end <= a || m.start >= b) continue;
        const s = Math.max(m.start, a);
        out += full.slice(pos, s);
        if (m.start >= a) out += m.repl;
        pos = Math.min(m.end, b);
      }
      out += full.slice(pos, b);
      if (out !== t.text) edits.push({ start: t.start, end: t.end, attrs: t.attrs, text: out });
    });
  }
  edits.sort((x, y) => y.start - x.start);
  let res = xml;
  for (const e of edits) {
    let attrs = e.attrs;
    if (!/xml:space=/.test(attrs)) attrs += ' xml:space="preserve"';
    res = res.slice(0, e.start) + '<w:t' + attrs + '>' + xmlEncode(e.text) + '</w:t>' + res.slice(e.end);
  }
  return res;
}
function applyMatches(text, matches) {
  let out = '', pos = 0;
  for (const m of matches) { out += text.slice(pos, m.start) + m.repl; pos = m.end; }
  return out + text.slice(pos);
}
function transformDocx(entries, matchFn, opts) {
  opts = opts || {};
  const dec = new TextDecoder('utf-8'), enc = new TextEncoder();
  const textFn = s => applyMatches(s, matchFn(s));
  const out = [];
  for (const e of entries) {
    const n = e.name;
    if (opts.scrub && /^docProps\/thumbnail\./.test(n)) continue;
    if (W_PARTS.test(n)) {
      let xml = rewriteXml(dec.decode(e.data), matchFn);
      if (opts.scrub) {
        xml = xml.replace(/(\bw:author=")[^"]*(")/g, '$1Anonyme$2').replace(/(\bw:initials=")[^"]*(")/g, '$1$2');
      }
      out.push({ name: n, data: enc.encode(xml) });
    } else if (/^word\/_rels\/.*\.rels$/.test(n)) {
      let xml = dec.decode(e.data);
      xml = xml.replace(/Target="((?:mailto:|https?:)[^"]*)"/g, (m, g) => 'Target="' + attrEncode(textFn(xmlDecode(g))) + '"');
      out.push({ name: n, data: enc.encode(xml) });
    } else if (n === 'docProps/core.xml') {
      let xml = dec.decode(e.data);
      if (opts.scrub) {
        xml = xml.replace(/(<dc:creator>)[\s\S]*?(<\/dc:creator>)/, '$1$2')
          .replace(/(<cp:lastModifiedBy>)[\s\S]*?(<\/cp:lastModifiedBy>)/, '$1$2');
      }
      for (const tag of ['dc:title', 'dc:subject', 'dc:description', 'cp:keywords']) {
        xml = xml.replace(new RegExp('(<' + tag + '>)([\\s\\S]*?)(</' + tag + '>)'),
          (m, a, b, c) => a + xmlEncode(textFn(xmlDecode(b))) + c);
      }
      out.push({ name: n, data: enc.encode(xml) });
    } else if (opts.scrub && n === 'docProps/app.xml') {
      let xml = dec.decode(e.data);
      xml = xml.replace(/(<Company>)[\s\S]*?(<\/Company>)/, '$1$2').replace(/(<Manager>)[\s\S]*?(<\/Manager>)/, '$1$2');
      out.push({ name: n, data: enc.encode(xml) });
    } else if (opts.scrub && n === '_rels/.rels') {
      let xml = dec.decode(e.data);
      xml = xml.replace(/<Relationship\b[^>]*thumbnail[^>]*\/>/gi, '');
      out.push({ name: n, data: enc.encode(xml) });
    } else out.push(e);
  }
  return out;
}

/* ---------- Recherche / remplacement ---------- */
function norm(s) { return s.normalize('NFC').replace(/’/g, "'").replace(/\s+/g, ' ').trim().toLowerCase(); }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
const CJK_EDGE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}【】（）「」『』《》]/u;
const CYR_WORD = /^[\u0400-\u04ff][\u0400-\u04ff\- ]{4,}$/;
/* Recherche des variantes dans un texte.
   - Écritures sans espaces (chinois, japonais…) : pas de borne de mot aux extrémités concernées.
   - Noms cyrilliques : une désinence casuelle de 1 à 3 lettres est tolérée (Иванов → Иванова, Иванову, Ивановым). */
function buildMatcher(items) {
  const map = new Map(), pats = [], cyr = [];
  for (const it of items) {
    for (const v of it.variants) {
      const k = norm(v);
      if (!k || map.has(k)) continue;
      map.set(k, it.repl);
      pats.push(v.trim());
      if (CYR_WORD.test(k)) cyr.push([k, it.repl]);
    }
  }
  if (!pats.length) return { fn: () => [], map };
  cyr.sort((a, b) => b[0].length - a[0].length);
  const cyrSet = new Set(cyr.map(x => x[0]));
  pats.sort((a, b) => b.length - a.length);
  const BL = '(?<![\\p{L}\\p{N}_])', BR = '(?![\\p{L}\\p{N}_])';
  const src = pats.map(p => {
    const chars = Array.from(p);
    const body = escapeRe(p).replace(/\s+/g, '\\s+').replace(/['’]/g, "['’]");
    const ending = cyrSet.has(norm(p)) ? '[\\u0400-\\u04ff]{0,3}' : '';
    return (CJK_EDGE.test(chars[0]) ? '' : BL) + body + ending + (CJK_EDGE.test(chars[chars.length - 1]) ? '' : BR);
  }).join('|');
  const re = new RegExp(src, 'giu');
  return {
    map,
    fn(text) {
      const out = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const nm = norm(m[0]);
        let r = map.get(nm);
        if (r === undefined) for (const [k, v] of cyr) if (nm.startsWith(k) && nm.length - k.length <= 3) { r = v; break; }
        if (r !== undefined) out.push({ start: m.index, end: m.index + m[0].length, repl: r });
      }
      return out;
    }
  };
}

/* ---------- Langues prises en charge : fr, en, es, pt, de, ru, zh ---------- */
const LANGS = ['fr', 'en', 'es', 'pt', 'de', 'ru', 'zh'];
/* Mots fréquents servant à reconnaître la langue des textes en alphabet latin.
   Un mot présent dans plusieurs langues compte moins (poids 1/n). */
const LANG_WORDS = {
  fr: 'le la les des du de un une et est dans pour par avec sur sont qui que ne pas au aux ce cette son ses ou mais entre selon ainsi dont lors chaque toute leur',
  en: 'the and of to in is that for with as by on are this be or from at an not have which it its was were will shall between any each such under upon hereby',
  es: 'el la los las de del que y en un una por con para es se no al lo su sus como más pero entre este esta son según cada todo todos sobre',
  pt: 'o a os as de do da dos das que e em um uma por com para é se não ao no na nos nas como mais mas entre este esta são segundo cada todo todos sobre',
  de: 'der die das den dem des und ist in zu mit von für auf ein eine einen nicht sich auch als bei nach aus wird sind oder zwischen werden dieser jede gemäß'
};
const LANG_WEIGHT = (() => {
  const count = new Map(), sets = {};
  for (const l of Object.keys(LANG_WORDS)) { sets[l] = new Set(LANG_WORDS[l].split(' ')); for (const w of sets[l]) count.set(w, (count.get(w) || 0) + 1); }
  const out = {};
  for (const l of Object.keys(sets)) { out[l] = new Map(); for (const w of sets[l]) out[l].set(w, 1 / count.get(w)); }
  return out;
})();
function detectLanguages(text) {
  const sample = String(text || '').slice(0, 30000);
  const han = (sample.match(/\p{Script=Han}/gu) || []).length;
  const cyr = (sample.match(/\p{Script=Cyrillic}/gu) || []).length;
  const lat = (sample.match(/\p{Script=Latin}/gu) || []).length;
  const total = han + cyr + lat;
  if (!total) return [];
  const scored = [];
  if (han / total >= 0.1) scored.push(['zh', han * 3]);
  if (cyr / total >= 0.1) scored.push(['ru', cyr]);
  if (lat / total >= 0.1) {
    const toks = sample.toLowerCase().match(/\p{L}+/gu) || [];
    const sc = {};
    for (const l of Object.keys(LANG_WEIGHT)) { sc[l] = 0; for (const t of toks) sc[l] += LANG_WEIGHT[l].get(t) || 0; }
    const best = Math.max(...Object.values(sc));
    if (best >= 1) for (const l of Object.keys(sc)) if (sc[l] >= Math.max(2, best * 0.55)) scored.push([l, sc[l] * 6]);
  }
  return scored.sort((a, b) => b[1] - a[1]).map(x => x[0]).slice(0, 3);
}

/* ---------- Détection automatique ---------- */
const CAPW = "\\p{Lu}[\\p{L}\\p{N}&'’\\-]*";
const CONN = "(?:\\s+(?:de|du|des|la|le|les|et|del|las|los|da|do|das|dos|di|of|für|von|van|der|&)\\s+|\\s+d['’]|\\s+)";
const SEQ = `${CAPW}(?:${CONN}${CAPW}){0,5}`;
const LF = "(?:GmbH\\s*&\\s*Co\\.?\\s*KG|S\\.\\s?A\\.\\s?de\\s+C\\.\\s?V\\.?|S\\.\\s?de\\s+R\\.\\s?L\\.?(?:\\s+de\\s+C\\.\\s?V\\.?)?|Unipessoal\\s+Lda\\.?|"
  + "SARL|SASU|SAS|SA|SPRLU|SPRL|SUARL|SCS|SNC|GIE|ASBL|SCRL|SCI|EURL|Ltd|LLC|LLP|PLC|plc|Inc|Corp|GmbH|AG|KG|OHG|GbR|UG|mbH|Limited|Ltda|Lda|SRL|SpA|"
  + "S\\.A\\.R\\.L\\.?|S\\.A\\.S\\.?|S\\.A\\.?|S\\.L\\.U\\.?|S\\.L\\.?|S\\.R\\.L\\.?|S\\.P\\.R\\.L\\.?|S\\.p\\.A\\.?|S/A|e\\.V\\.|EIRELI|Eireli)";
const RE_LEGAL = new RegExp(`(?<![\\p{L}\\p{N}])(${SEQ})\\s+(${LF})(?![\\p{L}\\p{N}])`, 'gu');
const ORG_WORDS = "Société|Entreprise|Ets|Établissements|Etablissements|Cabinet|Banque|Groupe|Compagnie|Fondation|Association|Clinique|Hôpital|Université|Ministère|"
 
  + "Empresa|Sociedad|Compañía|Banco|Grupo|Fundación|Asociación|Universidad|Ministerio|Instituto|Cooperativa|Despacho|Bufete|Ayuntamiento|"
  + "Sociedade|Companhia|Fundação|Associação|Universidade|Ministério|Escritório|Prefeitura|"
  + "Firma|Gesellschaft|Unternehmen|Gruppe|Stiftung|Verein|Universität|Krankenhaus|Klinikum|Ministerium|Institut|Genossenschaft|Kanzlei|Behörde|"
  + "Компания|Корпорация|Банк|Группа|Фонд|Ассоциация|Университет|Больница|Министерство|Институт|Агентство|Холдинг|Фирма";
const ORG_PREP = "(?:(?:of the|of|de la|de las|de los|del|de l['’]|du|des|de|da|do|das|dos|d['’]|für|der|die|das|von|zur|zum)\\s*)?";
const RE_ORGPREFIX = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ORG_WORDS})\\s+${ORG_PREP}${SEQ}`, 'gu');
const RE_ORGOF = new RegExp(`(?<![\\p{L}\\p{N}])(?:University|Bank|Ministry|Department|Institute|Foundation|Hospital|Agency|Council|College|School|Company|Group|Association|Trust|Corporation)\\s+of\\s+(?:the\\s+)?${SEQ}`, 'gu');
const RE_ORGQUOTED = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ORG_WORDS})\\s*[«"“„]([^»"”“\\n]{2,60})[»"”“]`, 'gu');
const ORG_SUFFIX = "Group|Holdings|Partners|Associates|Foundation|Institute|University|Bank|Consulting|Industries|Technologies|Solutions|Association|Company|Corporation|Stiftung|Verein|Gruppe|Grupo|Fundación|Fundação|Banco|Universidad|Universidade|Universität|Consultoría|Consultoria|Beratung|Kanzlei";
const RE_ORGSUFFIX = new RegExp(`(?<![\\p{L}\\p{N}])(${SEQ})\\s+(${ORG_SUFFIX})(?![\\p{L}\\p{N}])`, 'gu');
/* Russie : ООО « … », АО « … » */
const RU_LF = "(?:ООО|ОАО|ЗАО|ПАО|АО|ИП|НКО|ФГУП|МУП|ГУП)";
const RE_RU_ORGQ = new RegExp(`(?<![\\p{L}\\p{N}])${RU_LF}\\s*[«"“„]([^»"”“\\n]{2,60})[»"”“]`, 'gu');
const RE_RU_ORG = new RegExp(`(?<![\\p{L}\\p{N}])${RU_LF}\\s+(\\p{Lu}[\\p{L}\\-]+(?:\\s+\\p{Lu}[\\p{L}\\-]+){0,2})`, 'gu');
/* Chine : …有限公司, …银行, …大学 */
const ZH_ORG_SUFFIX = "(?:股份有限公司|有限责任公司|有限公司|集团公司|集团|分公司|子公司|银行|大学|学院|医院|基金会|协会|事务所|研究院|研究所|委员会|合作社|商会)";
const RE_ZH_ORG = new RegExp(`[\\p{Script=Han}A-Za-z0-9（）()]{2,14}?${ZH_ORG_SUFFIX}`, 'gu');
const ZH_LEAD = ['本合同', '合同', '我们的', '你们的', '他们的', '我们', '你们', '他们', '贵', '敝', '此', '这', '那', '协议书', '协议', '甲方', '乙方', '丙方', '签订', '签署', '签约', '支付', '交付', '委托', '聘请', '收购', '购买', '转让', '租赁', '由', '与', '和', '及', '向', '在', '于', '对', '给', '同', '跟', '被', '将', '把', '从', '为', '是', '的', '本', '该', '至', '到', '但', '或', '并', '且']
  .sort((a, b) => b.length - a.length);
const ZH_CUT = /(?:先生|女士|小姐|博士|教授|律师|医生|总经理|经理|董事长|总监|主任|老师|同志|工程师|会计师|[与和及由向对给跟同将把被从])/gu;
function zhStripLead(s) {
  // coupe après le dernier titre de personne ou mot de liaison qui précède le nom de la société
  let cut = 0;
  for (const m of s.matchAll(ZH_CUT)) { const end = m.index + m[0].length; if (s.length - end >= 4) cut = end; }
  s = s.slice(cut);
  let go = true;
  while (go) { go = false; for (const w of ZH_LEAD) if (s.length > w.length + 2 && s.startsWith(w)) { s = s.slice(w.length); go = true; break; } }
  return s;
}

/* Personnes : titres de civilité (fr, en, es, pt, de, ru) */
const HON = "(?:M\\.|Mr\\.?|Mrs\\.?|Ms\\.?|Miss|Mme\\.?|Mlle\\.?|Monsieur|Madame|Mademoiselle|Maître|Me|Dr\\.?|Dra\\.?|Docteur|Doctor|Doutor|Doutora|Pr\\.?|Prof\\.?|Professeur|Professor|Profesor|Profesora|Professora|Sieur|Honorable|Hon\\.|Mgr|Sir|Dame|Lord|Lady|"
  + "Sr\\.?|Sra\\.?|Srta\\.?|Señor|Señora|Señorita|Senhor|Senhora|Don|Doña|Dona|D\\.|Dña\\.|Lic\\.|Ing\\.|Eng\\.|Herr|Frau|Fräulein|Dipl\\.-Ing\\.|Mag\\.|г-н|г-жа|господин|госпожа|гражданин|гражданка)";
const NTOK = "(?:\\p{Lu}[\\p{L}'’\\-]+|\\p{Lu}\\.)";
const NPART = "(?:\\s+(?:de\\s+la|de\\s+los|de\\s+las|del|de|da|do|das|dos|di|du|von|van|der|den|zu|al|el|bin|ibn))*";
const NAME = `${NTOK}(?:${NPART}\\s*${NTOK}){0,3}`;
const RE_HON = new RegExp(`(?<![\\p{L}\\p{N}])(?:${HON}\\s+)+(${NAME})`, 'gu');
const RE_CAPS1 = /(?<![\p{L}\p{N}])\p{Lu}{2,}(?:[ \-]\p{Lu}{2,}){0,2} +\p{Lu}\p{Ll}+(?:[ \-]\p{Lu}\p{Ll}+)?(?![\p{L}])/gu;
const RE_CAPS2 = /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?:[ \-]\p{Lu}\p{Ll}+)?(?: | )+\p{Lu}{2,}(?: \p{Lu}{2,}){0,2}(?![\p{L}])/gu;
/* Initiales : « J. R. Smith », « Smith J.R. », « Иванов И.И. » */
const RE_INIT1 = /(?<![\p{L}\p{N}])\p{Lu}\.\s?(?:\p{Lu}\.\s?)?\p{Lu}[\p{L}'’\-]{2,}(?![\p{L}])/gu;
const RE_INIT2 = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’\-]{2,}\s+\p{Lu}\.\s?(?:\p{Lu}\.)?(?![\p{L}])/gu;
const RE_CYR_INIT = /(?<![\p{L}\p{N}])\p{Lu}[а-яё\-]{2,}\s+\p{Lu}\.\s?(?:\p{Lu}\.)?|(?<![\p{L}\p{N}])\p{Lu}\.\s?(?:\p{Lu}\.\s?)?\p{Lu}[а-яё\-]{2,}(?![\p{L}])/gu;
/* Noms russes complets : Фамилия Имя Отчество, Имя Отчество */
const RE_RU_FIO = /(?<![\p{L}\p{N}])(?:\p{Lu}[а-яё\-]+\s+)?\p{Lu}[а-яё\-]+\s+\p{Lu}[а-яё]+(?:(?:ович|евич|ьич)(?:а|у|ем|е)?|(?:овна|евна|ична|инична)(?:ы|е|у|ой)?)(?:\s+\p{Lu}[\u0430-\u044f\u0451\-]+)?(?![\p{L}])/gu;
/* Noms chinois : titre après le nom, étiquette devant le nom, translittération avec « · » */
const ZH_SURNAMES = "欧阳|司马|上官|诸葛|慕容|夏侯|皇甫|尉迟|公孙|长孙|东方|独孤|南宫|王|李|张|刘|陈|杨|黄|赵|吴|周|徐|孙|马|朱|胡|郭|何|高|林|罗|郑|梁|谢|宋|唐|许|韩|冯|邓|曹|彭|曾|肖|田|董|袁|潘|于|蒋|蔡|余|杜|叶|程|苏|魏|吕|丁|任|沈|姚|卢|姜|崔|钟|谭|陆|汪|范|金|石|廖|贾|夏|韦|付|方|白|邹|孟|熊|秦|邱|江|尹|薛|闫|段|雷|侯|龙|史|陶|黎|贺|顾|毛|郝|龚|邵|万|钱|严|覃|武|戴|莫|孔|向|汤";
const ZH_TITLE = "(?:先生|女士|小姐|博士|教授|律师|医生|总经理|经理|董事长|总监|主任|老师|同志|法官|工程师|会计师)";
const RE_ZH_PERSON = new RegExp(`((?:${ZH_SURNAMES})[\\p{Script=Han}]{0,2}?)(?=${ZH_TITLE})`, 'gu');
const RE_ZH_LABEL = /(?<=(?:姓名|名字|联系人|法定代表人|负责人|委托代理人|授权代表|签字人|甲方代表|乙方代表|代表人|申请人|被告|原告|当事人|收款人|付款人|户名)\s*[:：]\s*)[\p{Script=Han}]{2,5}(?:[·•][\p{Script=Han}]{1,6})?/gu;
const RE_ZH_TRANSL = /[\p{Script=Han}]{2,6}[·•][\p{Script=Han}]{2,6}/gu;

const RE_EMAIL = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.\p{L}{2,}/gu;
const RE_URL = /(?<![\p{L}\p{N}@.])(?:https?:\/\/|www\.)[^\s<>"'()«»]+[^\s<>"'()«».,;:!?]/giu;
const RE_PHONE = new RegExp("(?<![\\p{L}\\p{N}])(?:"
  + "(?:\\+|00)\\d{1,3}[\\s.-]?\\(?\\d{1,4}\\)?(?:[\\s.-]?\\d{2,4}){2,4}"
  + "|0\\d{1,2}(?:[\\s.-]?\\d{2,4}){2,4}"
  + "|0\\d{3,4}[\\s/-]\\d{4,8}"
  + "|0\\d{2,3}-\\d{7,8}"
  + "|8[\\s-]?\\(\\d{3}\\)[\\s-]?\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}"
  + "|\\(\\d{3}\\)\\s?\\d{3}[\\s.-]\\d{4}"
  + "|\\d{3}[\\s.-]\\d{3}[\\s.-]\\d{4}"
  + "|1[3-9]\\d{9}"
  + ")(?![\\p{L}\\p{N}])", 'gu');
const RE_IBAN = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/gu;
const RE_ID1 = /(?<![\p{L}\p{N}])[A-Z]{2}\/[A-Z]{2,4}\/RCCM\/[\w\-]+/giu;
const ID_LABELS = "NIF|IDNAT|Id\\.? ?Nat\\.?|RCCM|N° ?Impôt|Passport|Passeport|Pasaporte|Passaporte|Reisepass|Personalausweis|Ausweis|DNI|NIE|CIF|CPF|CNPJ|SSN|Steuer-ID|Steuernummer|USt-IdNr\\.?|VAT(?: No\\.?| number)?|паспорт|Паспорт|护照|身份证号码|身份证号|身份证";
const RE_ID2 = new RegExp(`(?<=(?:${ID_LABELS})(?:\\s*(?:No\\.?|Nr\\.?|n[°º]|number|numéro|número|номер|№|号码|号))?\\s*[:：#]?\\s*)(?=[A-Z0-9\\/.\\-]*\\d)[A-Z0-9][A-Z0-9\\/.\\-]{4,}[A-Z0-9]`, 'giu');
const RE_ID_NAT = new RegExp("(?<![\\p{L}\\p{N}])(?:"
  + "\\d{8}[A-HJ-NP-TV-Z]|[XYZ]\\d{7}[A-HJ-NP-TV-Z]|[ABCDEFGHJNPQRSUVW]\\d{7}[0-9A-J]"          // Espagne : DNI, NIE, CIF
  + "|\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}|\\d{2}\\.\\d{3}\\.\\d{3}\\/\\d{4}-\\d{2}"                    // Brésil : CPF, CNPJ
  + "|HR[AB]\\s?\\d{3,7}"                                                                         // Allemagne : registre du commerce
  + "|ATU\\d{8}|DE\\d{9}|BE0?\\d{9,10}|NL\\d{9}B\\d{2}|PT\\d{9}|IT\\d{11}|PL\\d{10}|ES[A-Z0-9]\\d{7}[A-Z0-9]|FR[A-Z0-9]{2}\\d{9}"   // TVA UE
  + "|\\d{3}-\\d{3}-\\d{3} \\d{2}"                                                                // Russie : SNILS
  + "|[1-9]\\d{5}(?:19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]"          // Chine : carte d'identité
  + "|[0-9A-HJ-NP-RT-UW-Y]{2}\\d{6}[0-9A-HJ-NP-RT-UW-Y]{10}"                                      // Chine : code de crédit social unifié
  + "|\\d{3}-\\d{2}-\\d{4}"                                                                      // États-Unis : SSN
  + ")(?![\\p{L}\\p{N}])", 'gu');
const RE_ID_RU = /(?<=(?:ИНН|ОГРНИП|ОГРН|КПП|СНИЛС|БИК)\s*[:№]?\s*)\d[\d\- ]{7,19}\d/gu;
const RE_ID_ZH = /(?<=统一社会信用代码\s*[:：]?\s*)[0-9A-Z]{18}/gu;
const RE_BANK = new RegExp("(?<=(?:账号|账户|卡号|银行账号|银行卡号|Account(?: No\\.?| Number)?|Konto(?:nummer)?|Cuenta|Conta|Счёт|Счет|р/с|расчётный счёт)\\s*[:：№#]?\\s*)\\d[\\d \\-]{9,28}\\d", 'giu');
const RE_SWIFT = /(?<=(?:SWIFT|BIC)\s*[:：]?\s*)[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?(?![A-Z0-9])/gu;

const CUR_W = "USD|EUR|GBP|CHF|CAD|AUD|CNY|RMB|RUB|BRL|MXN|CDF|FC|XAF|XOF|€|\\$|£|¥|￥|₽|R\\$|US\\$|"
  + "dollars?(?:\\s+américains?)?|euros?|francs?(?:\\s+congolais)?|pounds?|dólares?|dólar|libras?|reais|real|pesos?|Dollar|Euro|Franken|Pfund|рублей|рубля|рубль|руб\\.|долларов|евро|юаней|юань";
const SCALE = "(?:\\s?(?:millions?|millones|milhões|milhão|Millionen|Million|Mio\\.?|Mrd\\.?|billions?|млн|млрд|тыс\\.?)(?:\\s+de)?)?";
const RE_AMOUNT1 = new RegExp(`(?<![\\p{L}\\p{N}])\\d+(?:[ \\u00a0.,']\\d{3})*(?:[.,]\\d{1,2})?${SCALE}\\s?(?:${CUR_W})(?![\\p{L}])`, 'giu');
const RE_AMOUNT2 = new RegExp(`(?<![\\p{L}\\p{N}])(?:USD|\\$|€|EUR|£|GBP|¥|￥|₽|R\\$|US\\$|CHF|CNY|RMB)\\s?\\d+(?:[ \\u00a0.,']\\d{3})*(?:[.,]\\d{1,2})?(?![\\p{N}])`, 'giu');
const RE_AMOUNT3 = /(?<![\d.,])(?:人民币|美元|欧元|港币)?\d+(?:[,.]\d+)*\s?(?:万|亿)?(?:元|美元|欧元|块)/gu;
const MON = {
  fr: 'janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre',
  en: 'January|February|March|April|May|June|July|August|September|October|November|December',
  es: 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre',
  pt: 'janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro',
  de: 'Januar|Jänner|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember',
  ru: 'января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря'
};
const MONTHS = Object.values(MON).join('|');
const RE_DATE1 = new RegExp(`(?<![\\p{L}\\p{N}])\\d{1,2}(?:er|st|nd|rd|th|\\.|º|°)?\\s(?:de\\s)?(?:${MONTHS})(?:\\s(?:de|del)\\s|,?\\s)\\d{4}(?:\\s?г\\.?)?(?![\\p{L}\\p{N}])`, 'giu');
const RE_DATE_EN = new RegExp(`(?<![\\p{L}\\p{N}])(?:${MON.en}|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.?\\s\\d{1,2}(?:st|nd|rd|th)?,?\\s\\d{4}(?![\\p{L}\\p{N}])`, 'gu');
const RE_DATE2 = /(?<![\p{L}\p{N}])\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}(?![\p{L}\p{N}])/gu;
const RE_DATE_ISO = /(?<![\p{L}\p{N}])\d{4}-\d{2}-\d{2}(?![\p{L}\p{N}])/gu;
const RE_DATE_ZH = /\d{4}\s?年\s?\d{1,2}\s?月(?:\s?\d{1,2}\s?[日号])?/gu;

/* Mots à ne pas inclure en début de nom propre (début de phrase, articles, prépositions) */
const STOP_BY_LANG = {
  fr: 'entre et la le les l un une par avec pour chez de du des au aux à sous sur dans ledit ladite lesdits article contrat convention accord société sociétés projet si ou mais donc or ni car ce cette ces notre votre leur',
  en: 'the a an this that these those between and or by with for of to in on at from under agreement contract article section company party parties if but our your their dear',
  es: 'el la los las un una entre y e o por con para de del en al contrato acuerdo artículo sociedad empresa si pero nuestro vuestro su',
  pt: 'o a os as um uma entre e ou por com para de do da dos das em no na contrato acordo artigo sociedade empresa se mas nosso vosso seu',
  de: 'der die das den dem des ein eine einen zwischen und oder von mit für in im an auf bei vertrag vereinbarung artikel gesellschaft firma wenn aber unser ihr',
  ru: 'и в на с по для от к между договор соглашение статья компания если но'
};
let ACTIVE_STOP = new Set(Object.values(STOP_BY_LANG).join(' ').split(' '));
function setStopLangs(langs) {
  const l = (langs && langs.length ? langs : Object.keys(STOP_BY_LANG)).filter(x => STOP_BY_LANG[x]);
  const use = l.length ? l : Object.keys(STOP_BY_LANG);
  ACTIVE_STOP = new Set(use.map(x => STOP_BY_LANG[x]).join(' ').split(' '));
}
function isStop(w) { return ACTIVE_STOP.has(norm(w).replace(/'.*$/, '')); }
function stripStart(seq) {
  const words = seq.split(/\s+/);
  while (words.length > 1 && isStop(words[0])) words.shift();
  return words.join(' ');
}
function tokensOfName(name) {
  const vars = [name];
  const toks = name.split(/\s+/);
  if (toks.length > 1) for (const t of toks) if (t.replace(/[^\p{L}]/gu, '').length >= 4) vars.push(t);
  return vars;
}
function detect(text, opt) {
  const o = opt || {};
  const langs = (o.langs && o.langs.length) ? o.langs : detectLanguages(text);
  setStopLangs(langs);
  const found = new Map(), spans = [];
  const overlaps = (s, e) => spans.some(([a, b]) => s < b && e > a);
  const push = (type, variants, conf, key, idx) => {
    const k = type + '|' + norm(key);
    let e = found.get(k);
    if (!e) { e = { type, variants: [], conf, first: idx }; found.set(k, e); }
    for (const v of variants) {
      const t = (v || '').trim();
      if (t && !e.variants.some(x => norm(x) === norm(t))) e.variants.push(t);
    }
    if (idx < e.first) e.first = idx;
  };
  const claim = (m, type, variants, conf, key) => {
    const s = m.index, e = s + m[0].length;
    if (overlaps(s, e)) return false;
    spans.push([s, e]);
    push(type, variants, conf, key || m[0], s);
    return true;
  };
  if (o.org !== false) {
    for (const m of text.matchAll(RE_LEGAL)) {
      const full = m[0], seq = m[1], lf = m[2], stripped = stripStart(seq);
      const vars = [full];
      if (stripped !== seq) vars.push(stripped + ' ' + lf);
      if (stripped.length >= 3 && !isStop(stripped)) vars.push(stripped);
      spans.push([m.index, m.index + full.length]);
      push('org', vars, 'high', stripped, m.index);
    }
    for (const m of text.matchAll(RE_RU_ORGQ)) claim(m, 'org', [m[0], m[1].trim()], 'high', m[1]);
    for (const m of text.matchAll(RE_RU_ORG)) claim(m, 'org', [m[0], m[1]], 'high', m[1]);
    for (const m of text.matchAll(RE_ORGQUOTED)) claim(m, 'org', [m[0], m[1].trim()], 'high', m[1]);
    for (const m of text.matchAll(RE_ORGPREFIX)) claim(m, 'org', [m[0]], 'high');
    for (const m of text.matchAll(RE_ORGOF)) claim(m, 'org', [m[0]], 'high');
    for (const m of text.matchAll(RE_ORGSUFFIX)) {
      const stripped = stripStart(m[1]);
      if (isStop(stripped)) continue;
      claim(m, 'org', [m[0].replace(m[1], stripped), m[0]], 'high', stripped + ' ' + m[2]);
    }
    for (const m of text.matchAll(RE_ZH_ORG)) {
      const name = zhStripLead(m[0]);
      const s = m.index + (m[0].length - name.length), e = m.index + m[0].length;
      if (overlaps(s, e)) continue;
      spans.push([s, e]);
      push('org', [name], 'high', name, s);
    }
  }
  if (o.person !== false) {
    for (const m of text.matchAll(RE_HON)) {
      const name = m[1], e = m.index + m[0].length, s = e - name.length;
      if (overlaps(s, e)) continue;
      spans.push([s, e]);
      push('person', tokensOfName(name), 'high', name, s);
    }
    const mk = (re, conf, tokens) => {
      for (const m of text.matchAll(re)) claim(m, 'person', tokens ? tokensOfName(m[0]) : [m[0]], conf);
    };
    mk(RE_RU_FIO, 'high', true);
    mk(RE_CYR_INIT, 'high', true);
    for (const m of text.matchAll(RE_ZH_LABEL)) claim(m, 'person', [m[0]], 'high');
    for (const m of text.matchAll(RE_ZH_PERSON)) claim(m, 'person', [m[0]], 'high');
    for (const m of text.matchAll(RE_ZH_TRANSL)) claim(m, 'person', [m[0]], 'high');
    for (const re of [RE_CAPS1, RE_CAPS2]) mk(re, 'medium', true);
    for (const re of [RE_INIT1, RE_INIT2]) mk(re, 'medium', true);
  }
  const simple = (on, type, re, conf) => {
    if (on === false) return;
    for (const m of text.matchAll(re)) push(type, [m[0]], conf || 'high', m[0], m.index);
  };
  simple(o.email, 'email', RE_EMAIL);
  simple(o.url, 'url', RE_URL);
  simple(o.id, 'id', RE_ID1); simple(o.id, 'id', RE_ID2); simple(o.id, 'id', RE_ID_NAT);
  simple(o.id, 'id', RE_ID_RU); simple(o.id, 'id', RE_ID_ZH); simple(o.id, 'id', RE_SWIFT);
  simple(o.iban, 'iban', RE_IBAN); simple(o.iban, 'iban', RE_BANK);
  simple(o.phone, 'phone', RE_PHONE, 'medium');
  for (const re of [RE_AMOUNT1, RE_AMOUNT2, RE_AMOUNT3]) simple(o.amount === true, 'amount', re);
  for (const re of [RE_DATE1, RE_DATE_EN, RE_DATE2, RE_DATE_ISO, RE_DATE_ZH]) simple(o.date === true, 'date', re);
  const all = Array.from(found.values());
  const sure = new Set();
  for (const e of all) if (e.conf === 'high') for (const v of e.variants) sure.add(norm(v));
  return all.filter(e => e.conf === 'high' || !sure.has(norm(e.variants[0])));
}

/* ---------- Contrôle résiduel : mots à majuscule restant après anonymisation ---------- */
const COMMON_CAPS = new Set(['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'en', 'au', 'aux', 'dans', 'pour', 'par', 'sur',
  'avec', 'sans', 'ce', 'cette', 'ces', 'il', 'elle', 'ils', 'elles', 'si', 'mais', 'donc', 'car', 'chaque', 'tout', 'toute', 'tous',
  'toutes', 'article', 'articles', 'contrat', 'convention', 'entre', 'ainsi', 'dès', 'lorsque', 'lors', 'selon', 'conformément',
  'notamment', 'toutefois', 'cependant', 'sous', 'vers', 'chez', 'que', 'qui', 'quand', 'comme', 'afin', 'titre', 'chapitre', 'section',
  'partie', 'parties', 'annexe', 'objet', 'durée', 'fait', 'signé', 'lu', 'approuvé', 'république', 'démocratique', 'congo', 'monsieur', 'madame', 'mademoiselle', 'maître', 'docteur', 'professeur',
  'rccm', 'iban', 'nif', 'usd', 'eur', 'cdf', 'tva', 'sarl', 'sas', 'sasu', 'sprl',
  'the', 'this', 'that', 'and', 'for', 'with', 'between', 'agreement', 'article', 'section', 'party', 'parties', 'mr', 'mrs', 'ms',
  'el', 'los', 'las', 'del', 'por', 'con', 'contrato', 'acuerdo', 'artículo', 'señor', 'señora', 'os', 'as', 'uma', 'entre', 'acordo', 'artigo',
  'der', 'die', 'das', 'den', 'dem', 'und', 'vertrag', 'herr', 'frau', 'zwischen', 'договор', 'статья', 'соглашение']);
function residualWords(text, labelWords, limit) {
  const re = /(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’\-]{2,}(?![\p{L}])/gu;
  const stats = new Map();
  for (const m of text.matchAll(re)) {
    const w = m[0], k = w.toLowerCase();
    if (COMMON_CAPS.has(k) || labelWords.has(k)) continue;
    let j = m.index - 1;
    while (j >= 0 && (text[j] === ' ' || text[j] === '\u00a0')) j--;
    const sentenceStart = j < 0 || '.!?:;\n"«(–-•'.includes(text[j]);
    const allCaps = w === w.toUpperCase() && w.length >= 3;
    let s = stats.get(k);
    if (!s) { s = { word: w, total: 0, mid: 0, caps: allCaps }; stats.set(k, s); }
    s.total++;
    if (!sentenceStart) s.mid++;
  }
  return Array.from(stats.values()).filter(s => s.mid > 0 || s.caps)
    .sort((a, b) => b.total - a.total).slice(0, limit || 40);
}


/* ---------- Génération d'un .docx à partir de texte brut (PDF → Word) ---------- */
function buildDocxFromText(text) {
  const enc = new TextEncoder();
  const clean = t => t.replace(/[\u0000-\u0008\u000B\u000E-\u001F￾￿]/g, '').replace(/\t/g, '    ');
  const paras = [];
  const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  for (const line of text.split('\n')) {
    line.split('\f').forEach((seg, i) => {
      if (i > 0) paras.push(pageBreak);
      seg = clean(seg);
      paras.push(seg === '' ? '<w:p/>' : '<w:p><w:r><w:t xml:space="preserve">' + xmlEncode(seg) + '</w:t></w:r></w:p>');
    });
  }
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const H = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const files = {
    '[Content_Types].xml': H + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': H + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/styles.xml': H + '<w:styles ' + NS + '><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="fr-FR"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>',
    'word/document.xml': H + '<w:document ' + NS + '><w:body>' + paras.join('') + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>'
  };
  return zip(Object.entries(files).map(([name, xml]) => ({ name, data: enc.encode(xml) })));
}

if (typeof module !== 'undefined') {
  module.exports = { TYPES, TYPES_EN, TYPES_L, LANGS, detectLanguages, letters, formatLabel, unzip, zip, docxPartsText, transformDocx, applyMatches, buildMatcher, detect, norm, residualWords, paragraphTexts, rewriteXml, buildDocxFromText };
}
