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
/* Désignations anglaises (interface en anglais) */
const TYPES_EN = { person: 'Person', org: 'Company', other: 'Item', email: 'EMAIL', phone: 'PHONE', id: 'ID', iban: 'ACCOUNT', url: 'LINK', amount: 'AMOUNT', date: 'DATE' };

function letters(n) {
  let s = '';
  while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
  return s;
}
function formatLabel(type, n, lang) {
  const t = TYPES[type] || TYPES.other;
  const base = lang === 'en' ? (TYPES_EN[type] || TYPES_EN.other) : t.base;
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
function buildMatcher(items) {
  const map = new Map(), pats = [];
  for (const it of items) {
    for (const v of it.variants) {
      const k = norm(v);
      if (!k || map.has(k)) continue;
      map.set(k, it.repl);
      pats.push(v.trim());
    }
  }
  if (!pats.length) return { fn: () => [], map };
  pats.sort((a, b) => b.length - a.length);
  const src = pats.map(p => escapeRe(p).replace(/\s+/g, '\\s+').replace(/['’]/g, "['’]")).join('|');
  const re = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + src + ')(?![\\p{L}\\p{N}_])', 'giu');
  return {
    map,
    fn(text) {
      const out = [];
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        if (m[0].length === 0) { re.lastIndex++; continue; }
        const r = map.get(norm(m[0]));
        if (r !== undefined) out.push({ start: m.index, end: m.index + m[0].length, repl: r });
      }
      return out;
    }
  };
}

/* ---------- Détection automatique ---------- */
const CAPW = "\\p{Lu}[\\p{L}\\p{N}&'’\\-]*";
const CONN = "(?:\\s+(?:de|du|des|la|le|les|et|of|and|&)\\s+|\\s+d['’]|\\s+)";
const SEQ = `${CAPW}(?:${CONN}${CAPW}){0,5}`;
const LF = "(?:SARL|SASU|SAS|SA|SPRLU|SPRL|SUARL|SCS|SNC|GIE|ASBL|SCRL|Ltd|LLC|Inc|GmbH|Limited|S\\.A\\.R\\.L\\.?|S\\.A\\.S\\.?|S\\.A\\.?|S\\.P\\.R\\.L\\.?)";
const RE_LEGAL = new RegExp(`(?<![\\p{L}\\p{N}])(${SEQ})\\s+(${LF})(?![\\p{L}\\p{N}])`, 'gu');
const RE_ORGPREFIX = new RegExp(`(?<![\\p{L}\\p{N}])(?:Société|Entreprise|Ets|Établissements|Etablissements|Cabinet|Banque|Groupe|Compagnie|Fondation|Association|Clinique|Hôpital|Université|Ministère)\\s+(?:(?:de la|de l['’]|du|des|de|d['’])\\s*)?${SEQ}`, 'gu');
const HON = "(?:M\\.|Mr\\.?|Mme\\.?|Mlle\\.?|Monsieur|Madame|Mademoiselle|Maître|Me|Dr\\.?|Docteur|Pr\\.?|Professeur|Sieur|Honorable|Hon\\.|Mgr)";
const NAMEW = "\\p{Lu}[\\p{L}'’\\-]+";
const RE_HON = new RegExp(`(?<![\\p{L}\\p{N}])${HON}\\s+((?:${NAMEW})(?:\\s+${NAMEW}){0,3})`, 'gu');
const RE_CAPS1 = /(?<![\p{L}\p{N}])\p{Lu}{2,}(?:[ \-]\p{Lu}{2,}){0,2} +\p{Lu}\p{Ll}+(?:[ \-]\p{Lu}\p{Ll}+)?(?![\p{L}])/gu;
const RE_CAPS2 = /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?:[ \-]\p{Lu}\p{Ll}+)? +\p{Lu}{2,}(?: \p{Lu}{2,}){0,2}(?![\p{L}])/gu;
const RE_EMAIL = /[\p{L}\p{N}._%+\-]+@[\p{L}\p{N}.\-]+\.\p{L}{2,}/gu;
const RE_URL = /(?<![\p{L}\p{N}@.])(?:https?:\/\/|www\.)[^\s<>"'()«»]+[^\s<>"'()«».,;:!?]/giu;
const RE_PHONE = /(?<![\p{L}\p{N}])(?:(?:\+|00)\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}|0\d{1,2}(?:[\s.-]?\d{2,4}){2,4})(?![\p{L}\p{N}])/gu;
const RE_IBAN = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/gu;
const RE_ID1 = /(?<![\p{L}\p{N}])[A-Z]{2}\/[A-Z]{2,4}\/RCCM\/[\w\-]+/giu;
const RE_ID2 = /(?<=\b(?:NIF|IDNAT|Id\.? ?Nat\.?|RCCM|N° ?Impôt)\s*:?\s*)(?=[A-Z0-9\/.\-]*\d)[A-Z0-9][A-Z0-9\/.\-]{4,}[A-Z0-9]/giu;
const RE_AMOUNT1 = /(?<![\p{L}\p{N}])\d+(?:[ \u00a0.,]\d{3})*(?:[.,]\d{1,2})?\s?(?:USD|EUR|CDF|FC|XAF|XOF|€|\$|dollars?(?:\s+américains?)?|euros?|francs?(?:\s+congolais)?)(?![\p{L}])/giu;
const RE_AMOUNT2 = /(?<![\p{L}\p{N}])(?:USD|\$|€|EUR)\s?\d+(?:[ \u00a0.,]\d{3})*(?:[.,]\d{1,2})?(?![\p{N}])/giu;
const RE_DATE1 = /(?<![\p{L}\p{N}])\d{1,2}(?:er)?\s(?:janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s\d{4}(?![\p{L}\p{N}])/giu;
const RE_DATE2 = /(?<![\p{L}\p{N}])\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}(?![\p{L}\p{N}])/gu;

const STOP_START = new Set(['entre', 'et', 'la', 'le', 'les', 'l', 'un', 'une', 'par', 'avec', 'pour', 'chez', 'de', 'du', 'des',
  'au', 'aux', 'à', 'sous', 'sur', 'dans', 'ledit', 'ladite', 'lesdits', 'article', 'contrat', 'convention', 'accord', 'société',
  'sociétés', 'projet', 'si', 'ou', 'mais', 'donc', 'or', 'ni', 'car', 'ce', 'cette', 'ces', 'notre', 'votre', 'leur']);
function isStop(w) { return STOP_START.has(norm(w).replace(/'.*$/, '')); }
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
  if (o.org !== false) {
    for (const m of text.matchAll(RE_LEGAL)) {
      const full = m[0], seq = m[1], lf = m[2], stripped = stripStart(seq);
      const vars = [full];
      if (stripped !== seq) vars.push(stripped + ' ' + lf);
      if (stripped.length >= 3 && !isStop(stripped)) vars.push(stripped);
      spans.push([m.index, m.index + full.length]);
      push('org', vars, 'high', stripped, m.index);
    }
    for (const m of text.matchAll(RE_ORGPREFIX)) {
      const s = m.index, e = s + m[0].length;
      if (overlaps(s, e)) continue;
      spans.push([s, e]);
      push('org', [m[0]], 'high', m[0], s);
    }
  }
  if (o.person !== false) {
    for (const m of text.matchAll(RE_HON)) {
      const name = m[1], e = m.index + m[0].length, s = e - name.length;
      if (overlaps(s, e)) continue;
      spans.push([s, e]);
      push('person', tokensOfName(name), 'high', name, s);
    }
    for (const re of [RE_CAPS1, RE_CAPS2]) {
      for (const m of text.matchAll(re)) {
        const s = m.index, e = s + m[0].length;
        if (overlaps(s, e)) continue;
        spans.push([s, e]);
        push('person', tokensOfName(m[0]), 'medium', m[0], s);
      }
    }
  }
  const simple = (on, type, re, conf) => {
    if (on === false) return;
    for (const m of text.matchAll(re)) push(type, [m[0]], conf || 'high', m[0], m.index);
  };
  simple(o.email, 'email', RE_EMAIL);
  simple(o.url, 'url', RE_URL);
  simple(o.id, 'id', RE_ID1); simple(o.id, 'id', RE_ID2);
  simple(o.iban, 'iban', RE_IBAN);
  simple(o.phone, 'phone', RE_PHONE, 'medium');
  simple(o.amount === true, 'amount', RE_AMOUNT1); simple(o.amount === true, 'amount', RE_AMOUNT2);
  simple(o.date === true, 'date', RE_DATE1); simple(o.date === true, 'date', RE_DATE2);
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
  'rccm', 'iban', 'nif', 'usd', 'eur', 'cdf', 'tva', 'sarl', 'sas', 'sasu', 'sprl']);
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
  module.exports = { TYPES, TYPES_EN, letters, formatLabel, unzip, zip, docxPartsText, transformDocx, applyMatches, buildMatcher, detect, norm, residualWords, paragraphTexts, rewriteXml, buildDocxFromText };
}
