/* ===== Interface ===== */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain;charset=utf-8', pdf: 'application/pdf' };
const state = { kind: null, name: '', zip: null, text: '', media: 0, items: [], nextId: 1, result: null, histId: null, step: 1, restored: null, langs: [], rMap: null, rDocs: [], rResults: [], pinned: null };

function say(id, text, cls) {
  const el = $(id);
  if (!text) { el.className = 'msg'; el.textContent = ''; return; }
  el.className = 'msg show ' + (cls || '');
  el.textContent = text;
}
function fmt(n) { return n.toLocaleString(locale()); }
function safeName(n) { return (n || 'document').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().replace(/\s+/g, '_') || 'document'; }
function baseName() { return safeName(state.name); }
function extOf(f) { return (f.name.split('.').pop() || '').toLowerCase(); }

/* ---- Bibliothèques PDF (embarquées, chargées à la demande) ---- */
let pdfjs = null;
const blobUrl = id => URL.createObjectURL(new Blob([$(id).textContent], { type: 'text/javascript' }));
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  const lib = await import(blobUrl('#lib-pdfjs'));
  lib.GlobalWorkerOptions.workerSrc = blobUrl('#lib-worker');
  pdfjs = lib;
  return lib;
}
function loadPdfLib() {
  if (window.PDFLib) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = blobUrl('#lib-pdflib');
    s.onload = res;
    s.onerror = () => rej(new Error(t('err.pdflib')));
    document.head.appendChild(s);
  });
}
function layoutText(items) {
  let out = '', lastY = null, lastX2 = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const x = it.transform[4], y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (lastY !== null) {
      const dy = Math.abs(y - lastY);
      if (dy > h * 0.6) { if (!out.endsWith('\n')) out += '\n'; if (dy > h * 1.9) out += '\n'; }
      else if (lastX2 !== null && x - lastX2 > h * 0.15 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
    }
    out += it.str;
    lastY = y; lastX2 = x + (it.width || 0);
    if (it.hasEOL) { if (!out.endsWith('\n')) out += '\n'; lastX2 = null; }
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function pdfToText(buf) {
  const lib = await loadPdfJs();
  let pdf, task;
  try {
    task = lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
    pdf = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error(t('err.pdfpw'));
    throw new Error(t('err.pdfbad'));
  }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    pages.push(layoutText((await page.getTextContent()).items));
    page.cleanup();
  }
  try { await task.destroy(); } catch (e) { /* ignore */ }
  return { text: pages.join('\f'), pages: pages.length };
}
async function buildPdfFromText(text) {
  await loadPdfLib();
  const { PDFDocument, StandardFonts } = window.PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(''); doc.setAuthor(''); doc.setSubject(''); doc.setKeywords([]); doc.setProducer(''); doc.setCreator('');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ok = new Set(font.getCharacterSet());
  const clean = s => Array.from(s.replace(/\t/g, '    ').replace(/ /g, ' ')).map(c => (ok.has(c.codePointAt(0)) ? c : '?')).join('');
  const W = 595.28, H = 841.89, M = 56, size = 11, lh = 15, maxW = W - 2 * M;
  let page = doc.addPage([W, H]), y = H - M;
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const put = line => { if (y < M) newPage(); if (line) page.drawText(line, { x: M, y: y - size, size, font }); y -= lh; };
  const wrap = line => {
    const words = clean(line).split(/ +/), lines = [];
    let cur = '';
    const push = w => {
      while (font.widthOfTextAtSize(w, size) > maxW) {
        let k = w.length;
        while (k > 1 && font.widthOfTextAtSize(w.slice(0, k), size) > maxW) k--;
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      cur = w;
    };
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (font.widthOfTextAtSize(t, size) <= maxW) cur = t;
      else { if (cur) lines.push(cur); push(w); }
    }
    lines.push(cur);
    return lines;
  };
  for (const raw of text.split('\n')) {
    raw.split('\f').forEach((seg, i) => {
      if (i > 0) newPage();
      if (seg.trim() === '') put('');
      else for (const l of wrap(seg)) put(l);
    });
  }
  return await doc.save();
}

/* ---- Téléchargements ---- */
function download(name, data, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: mime }));
  a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
/* d = { kind: 'docx'|'pdf'|'txt', text, bytes (docx) } */
const NON_LATIN = /[\u0400-\u04FF\u3000-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
function outputsOf(d) {
  const L = [];
  const docxFn = async () => ({ data: d.kind === 'docx' ? d.bytes : buildDocxFromText(d.text), mime: MIME.docx });
  const pdfFn = async () => ({ data: await buildPdfFromText(d.text), mime: MIME.pdf });
  const txtFn = async () => ({ data: d.text.replace(/\f/g, '\n\n'), mime: MIME.txt });
  /* Le PDF est proposé pour tout document (Word, PDF ou texte). Il est généré à partir du texte :
     la mise en page d'origine n'est pas conservée, et la police du PDF ne couvre pas le cyrillique ni le chinois. */
  const word = (label, primary) => [label, 'docx', docxFn, primary];
  const wordLabel = d.kind === 'docx' ? t('dl.docx') : t('dl.docxv');
  if (NON_LATIN.test(d.text)) L.push(word(wordLabel, true), [t('dl.txt'), 'txt', txtFn], [t('dl.pdf'), 'pdf', pdfFn]);
  else if (d.kind === 'docx') L.push(word(wordLabel, true), [t('dl.pdf'), 'pdf', pdfFn], [t('dl.txt'), 'txt', txtFn]);
  else L.push([t('dl.pdf'), 'pdf', pdfFn, true], word(wordLabel), [t('dl.txt'), 'txt', txtFn]);
  return L;
}
function renderDownloads(box, d, suffix, msgSel, mapping) {
  box.innerHTML = '';
  if (NON_LATIN.test(d.text) && msgSel) say(msgSel, t('dl.pdfWarn'), 'warn');
  for (const [label, ext, fn, primary] of outputsOf(d)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn' + (primary ? '' : ' sec'); b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await fn(); download(`${d.name}${suffix}.${ext}`, r.data, r.mime); logActivity('export', { fmt: ext });
        if (mapping && prefs.autoTable) { setTimeout(() => exportMap(mapping, 'json', state.name), 600); say(msgSel, t('dl.autoTable'), 'ok'); } }
      catch (e) { say(msgSel, t('err.generic', { m: e.message || e }), 'err'); }
      b.disabled = false;
    });
    box.appendChild(b);
  }
}
const previewHtml = t => t.replace(/\f/g, '\n\n— — —\n\n');

/* ---- Étapes ---- */
function setStep(n) {
  state.step = n;
  document.querySelectorAll('#steps li').forEach((li, i) => {
    li.classList.toggle('done', i + 1 < n);
    li.classList.toggle('cur', i + 1 === n);
    if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}
const typeName = k => t('type.' + (TYPES[k] ? k : 'other'));
const typeBase = k => { const L = TYPES_L[labLang()]; return L ? (L[k] || L.other) : (TYPES[k] || TYPES.other).base; };
function docLangs() { const v = $('#doc-lang').value; return v === 'auto' ? state.langs : [v]; }
function showLang() {
  const el = $('#lang-info');
  if (!state.kind) { el.textContent = ''; return; }
  const L = docLangs();
  const names = L.map(x => t('lg.' + x)).join(', ');
  el.textContent = L.length ? t($('#doc-lang').value === 'auto' ? 'dl.detected' : 'dl.chosen', { l: names }) : t('dl.unknown');
}
$('#doc-lang').addEventListener('change', showLang);
const docLabel = () => (prefs.keepNames ? state.name : t('doc.generic'));

/* ---- 1. Chargement ---- */
function resetAnalysis() {
  state.items = []; state.result = null; state.histId = null; state.langs = [];
  $('#lang-info').textContent = '';
  $('#s3').hidden = true; $('#s4').hidden = true;
  say('#m2', ''); say('#m3', '');
  setStep(1);
}
async function onFile(file) {
  if (!file) return;
  resetAnalysis();
  const ext = extOf(file);
  try {
    say('#m1', t('msg.reading'), 'ok busy');
    if (ext === 'doc') throw new Error(t('err.doc'));
    let pagesInfo = '';
    if (ext === 'pdf') {
      const r = await pdfToText(await file.arrayBuffer());
      if (r.text.replace(/\s/g, '').length < 20 * r.pages) throw new Error(t('err.scan'));
      state.kind = 'pdf'; state.zip = null; state.text = r.text; state.media = 0;
      pagesInfo = t('pages.n', { n: r.pages });
    } else if (ext === 'docx') {
      const ents = await unzip(await file.arrayBuffer());
      if (!ents.some(e => e.name === 'word/document.xml')) throw new Error(t('err.docx'));
      state.kind = 'docx'; state.zip = ents; state.text = docxPartsText(ents);
      state.media = ents.filter(e => /^word\/media\//.test(e.name)).length;
    } else if (['txt', 'md', 'csv'].includes(ext)) {
      state.kind = 'txt'; state.zip = null; state.text = await file.text(); state.media = 0;
    } else throw new Error(t('err.format'));
    state.name = file.name.replace(/\.[^.]+$/, '');
    let info = t('msg.loaded', { file: file.name, pages: pagesInfo, chars: fmt(state.text.length) });
    let cls = 'ok';
    if (state.media) { info += ' ' + t('msg.media', { n: state.media }); cls = 'warn'; }
    if (!state.text.trim()) { info = t('msg.empty'); cls = 'err'; state.kind = null; }
    say('#m1', info, cls);
    if (state.kind) { state.langs = detectLanguages(state.text); showLang(); setStep(2); logActivity('import', { kind: state.kind }); }
  } catch (e) {
    state.kind = null;
    say('#m1', e.message || String(e), 'err');
  }
}
$('#file').addEventListener('change', e => onFile(e.target.files[0]));
$('#use-paste').addEventListener('click', () => {
  const txt = $('#paste').value;
  if (!txt.trim()) return say('#m1', t('msg.nopaste'), 'err');
  resetAnalysis();
  state.kind = 'txt'; state.zip = null; state.text = txt; state.name = t('name.text'); state.media = 0;
  say('#m1', t('msg.pasted', { chars: fmt(txt.length) }), 'ok');
  state.langs = detectLanguages(txt); showLang();
  setStep(2); logActivity('paste');
});

/* ---- 2. Analyse ---- */
function mkItem(type, variants, source, conf) {
  return {
    id: state.nextId++, type, variants, custom: '', auto: '', source, conf,
    include: source === 'manuel' || conf === 'high' || type === 'phone', count: 0, first: Infinity
  };
}
function parseVariants(s) { return s.split('|').map(x => x.trim()).filter(Boolean); }

function analyze() {
  if (!state.kind || !state.text.trim()) return say('#m2', t('err.needDoc'), 'err');
  say('#m2', '');
  const manual = [];
  for (const [sel, type] of [['#m-org', 'org'], ['#m-person', 'person'], ['#m-other', 'other']]) {
    for (const line of $(sel).value.split('\n')) {
      const v = parseVariants(line);
      if (v.length) manual.push(mkItem(type, v, 'manuel', 'high'));
    }
  }
  const manualKeys = new Set(manual.flatMap(i => i.variants.map(norm)));
  const opt = {
    org: $('#o-org').checked, person: $('#o-person').checked, email: $('#o-email').checked, phone: $('#o-phone').checked,
    address: $('#o-address').checked, number: $('#o-number').checked,
    id: $('#o-id').checked, iban: $('#o-iban').checked, url: $('#o-url').checked, amount: $('#o-amount').checked, date: $('#o-date').checked
  };
  const order = Object.keys(TYPES);
  opt.langs = docLangs();
  const auto = detect(state.text, opt)
    .map(e => ({ ...e, variants: e.variants.filter(v => !manualKeys.has(norm(v))) }))
    .filter(e => e.variants.length)
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.first - b.first)
    .map(e => mkItem(e.type, e.variants, 'auto', e.conf));
  state.items = [...manual, ...auto];
  state.result = null;
  $('#s4').hidden = true;
  computeStats();
  renderItems();
  $('#s3').hidden = false;
  const found = state.items.filter(i => i.count > 0).length;
  say('#m2', state.items.length ? t('msg.found', { n: state.items.length, f: found }) : t('msg.nofound'), state.items.length ? 'ok' : 'warn');
  setStep(3); logActivity('analyze', { n: state.items.length });
  $('#s3').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#analyze').addEventListener('click', analyze);

/* ---- 3. Contrôle ---- */
function computeStats() {
  const m = buildMatcher(state.items.map((it, i) => ({ variants: it.variants, repl: i })));
  state.items.forEach(it => { it.count = 0; it.first = Infinity; });
  for (const x of m.fn(state.text)) {
    const it = state.items[x.repl];
    it.count++;
    if (x.start < it.first) it.first = x.start;
  }
  const cnt = {};
  const active = state.items.filter(i => i.include).sort((a, b) => (a.first === b.first ? 0 : a.first < b.first ? -1 : 1));
  for (const it of active) {
    if (it.custom) continue;
    cnt[it.type] = (cnt[it.type] || 0) + 1;
    it.auto = formatLabel(it.type, cnt[it.type], labLang());
  }
  for (const it of state.items) if (!it.include && !it.auto) it.auto = typeBase(it.type);
}
function countText(it) { return it.count ? t(it.count > 1 ? 'occ.many' : 'occ.one', { n: it.count }) : t('occ.none'); }

function renderItems() {
  const typeOpts = k => Object.keys(TYPES).map(tp => `<option value="${tp}"${tp === k ? ' selected' : ''}>${esc(typeName(tp))}</option>`).join('');
  $('#items').innerHTML = state.items.map(it => `
<div class="item${it.include ? '' : ' off'}" data-id="${it.id}">
  <div class="item-top">
    <input type="checkbox" class="f-inc" aria-label="${esc(t('it.inc'))}"${it.include ? ' checked' : ''}>
    <select class="f-type" aria-label="${esc(t('it.type'))}">${typeOpts(it.type)}</select>
    <span class="badge cnt">${esc(countText(it))}</span>
    ${it.conf === 'medium' ? `<span class="badge warn">${esc(t('it.verify'))}</span>` : ''}
    <button class="x f-del" type="button" title="${esc(t('it.del'))}" aria-label="${esc(t('it.del'))}">×</button>
  </div>
  <div><label class="lbl">${esc(t('it.txt'))} <small>${esc(t('it.txtHint'))}</small></label>
  <input type="text" class="f-var" value="${esc(it.variants.join(' | '))}"></div>
  <div><label class="lbl">${esc(t('it.repl'))}</label>
  <input type="text" class="f-lab" value="${esc(it.custom)}" placeholder="${esc(it.auto)}"></div>
</div>`).join('') || `<p class="hint">${esc(t('it.none'))}</p>`;
}
function refreshDom() {
  for (const card of document.querySelectorAll('#items .item')) {
    const it = state.items.find(i => i.id === +card.dataset.id);
    if (!it) continue;
    $('.cnt', card).textContent = countText(it);
    $('.f-lab', card).placeholder = it.auto;
    card.classList.toggle('off', !it.include);
  }
}
let timer = null;
function later(fn) { clearTimeout(timer); timer = setTimeout(fn, 250); }
const itemOf = el => state.items.find(i => i.id === +el.closest('.item').dataset.id);

$('#items').addEventListener('change', e => {
  const it = itemOf(e.target);
  if (!it) return;
  if (e.target.classList.contains('f-inc')) it.include = e.target.checked;
  else if (e.target.classList.contains('f-type')) it.type = e.target.value;
  computeStats(); refreshDom();
});
$('#items').addEventListener('input', e => {
  const it = itemOf(e.target);
  if (!it) return;
  if (e.target.classList.contains('f-var')) { it.variants = parseVariants(e.target.value); later(() => { computeStats(); refreshDom(); }); }
  else if (e.target.classList.contains('f-lab')) { it.custom = e.target.value.trim(); later(() => { computeStats(); refreshDom(); }); }
});
$('#items').addEventListener('click', e => {
  if (!e.target.classList.contains('f-del')) return;
  const it = itemOf(e.target);
  state.items = state.items.filter(i => i !== it);
  computeStats(); renderItems();
});

function renderTypeSelect() {
  const cur = $('#add-type').value || 'other';
  $('#add-type').innerHTML = Object.keys(TYPES).map(k => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(typeName(k))}</option>`).join('');
}
renderTypeSelect();
function addItem(type, variants) {
  const it = mkItem(type, variants, 'manuel', 'high');
  state.items.push(it);
  computeStats(); renderItems();
  return it;
}
$('#add-btn').addEventListener('click', () => {
  const v = parseVariants($('#add-var').value);
  if (!v.length) return;
  addItem($('#add-type').value, v);
  $('#add-var').value = '';
});

/* ---- 4. Remplacement, aperçu et export ---- */
function highlight(text, labels) {
  const m = buildMatcher([{ variants: labels, repl: 1 }]).fn(text);
  let out = '', pos = 0;
  for (const x of m) { out += esc(text.slice(pos, x.start)) + '<mark>' + esc(text.slice(x.start, x.end)) + '</mark>'; pos = x.end; }
  return out + esc(text.slice(pos));
}
function buildMapping(active) {
  const g = new Map();
  for (const it of active) {
    const label = it.custom || it.auto;
    let e = g.get(label);
    if (!e) { e = { label, type: it.type, values: [] }; g.set(label, e); }
    for (const v of it.variants) if (!e.values.some(x => norm(x) === norm(v))) e.values.push(v);
  }
  return { format: 'anonymiseur-v1', id: 'm' + Date.now().toString(36), created: new Date().toISOString(), document: docLabel(), entries: [...g.values()] };
}
function renderResult() {
  const r = state.result;
  if (!r) return;
  const { d, mapping, total, left } = r;
  $('#stats').innerHTML =
    `<div class="stat"><b>${fmt(total)}</b>${esc(t('stat.repl'))}</div>` +
    `<div class="stat"><b>${mapping.entries.length}</b>${esc(t('stat.names'))}</div>` +
    `<div class="stat"><b style="color:${left ? 'var(--bad)' : 'var(--ok)'}">${left}</b>${esc(t('stat.left'))}</div>`;
  const labels = mapping.entries.map(e => e.label);
  const shown = previewHtml(d.text).slice(0, 8000);
  $('#preview').innerHTML = highlight(shown, labels) + (d.text.length > 8000 ? '\n\n' + esc(t('s4.prevMore')) : '');
  const labelWords = new Set(labels.flatMap(l => l.toLowerCase().split(/[\s\[\]\d]+/)).filter(Boolean));
  const res = residualWords(d.text, labelWords, 40);
  $('#residual').innerHTML = res.length
    ? res.map(x => `<button type="button" class="chip" data-w="${esc(x.word)}">${esc(x.word)}<i>×${x.total}</i></button>`).join('')
    : `<span class="hint">${esc(t('s4.noRes'))}</span>`;
  renderDownloads($('#dl-box'), d, t('suffix.anon'), '#m4', mapping);
  $('#s4').hidden = false;
}
function run() {
  try {
    computeStats();
    const active = state.items.filter(i => i.include && i.variants.length);
    if (!active.length) { say('#m3', t('err.nosel'), 'err'); return false; }
    const matcher = buildMatcher(active.map(i => ({ variants: i.variants, repl: i.custom || i.auto })));
    const total = matcher.fn(state.text).length;
    let d;
    if (state.kind === 'docx') {
      const ents = transformDocx(state.zip, matcher.fn, { scrub: true });
      d = { kind: 'docx', bytes: zip(ents), text: docxPartsText(ents) };
    } else {
      d = { kind: state.kind, text: applyMatches(state.text, matcher.fn(state.text)) };
    }
    d.name = baseName();
    const left = buildMatcher(active.map(i => ({ variants: i.variants, repl: 1 }))).fn(d.text).length;
    const mapping = buildMapping(active);
    state.result = { d, mapping, total, left };
    say('#m4', '');
    say('#m3', '');
    renderResult();
    refreshMapChoices();
    setStep(4);
    if (!state.histId) state.histId = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    afterRun(state.result, state.histId);
    histUpsert({ id: state.histId, ts: Date.now(), name: prefs.keepNames ? state.name : '', kind: state.kind, replacements: total, designations: mapping.entries.length, residual: left });
    logActivity('apply', { r: total, n: mapping.entries.length });
    return true;
  } catch (e) { say('#m3', t('err.generic', { m: e.message || e }), 'err'); return false; }
}
/* Conservation automatique de la table (chiffrée par une clé de l'appareil) avec l'empreinte du document anonymisé */
async function afterRun(r, hid) {
  const note = $('#auto-note');
  note.textContent = '';
  r.fp = await fingerprint(r.d.text);
  if (!prefs.autoSave) return;
  try {
    await autoAdd(r.mapping, r.fp, hid);
    histUpsert({ id: hid, mapId: r.mapping.id });
    if (state.result === r) note.textContent = t('dl.autoSaved');
  } catch (e) { if (state.result === r) note.textContent = t('dl.autoSaveFail'); }
}
$('#run').addEventListener('click', () => { if (run()) $('#s4').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#residual').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  addItem('other', [b.dataset.w]);
  run();
});

/* ---- Tables de correspondance : export ---- */
function mapJson(mapping) { return JSON.stringify(mapping, null, 2); }
function mapCsv(mapping) {
  const rows = [[t('csv.label'), t('csv.type'), t('csv.vals')].map(csvCell).join(';')];
  for (const e of mapping.entries) rows.push([e.label, typeName(e.type), (e.values || []).join(' | ')].map(csvCell).join(';'));
  return '﻿' + rows.join('\r\n');
}
function exportMap(mapping, fmt, base) {
  const name = `${safeName(base)}${t('suffix.map')}`;
  if (fmt === 'json') download(name + '.json', mapJson(mapping), 'application/json');
  else download(name + '.csv', mapCsv(mapping), 'text/csv;charset=utf-8');
  logActivity('exportmap', { fmt });
}
$('#dl-json').addEventListener('click', () => state.result && exportMap(state.result.mapping, 'json', state.name));
$('#dl-csv').addEventListener('click', () => state.result && exportMap(state.result.mapping, 'csv', state.name));

/* ---- Coffre chiffré : enregistrement et sélection ---- */
function vaultErr(e) {
  const m = e && e.message;
  if (m === 'crypto') return t('vt.crypto');
  if (m === 'storage') return t('vt.storage');
  if (m === 'locked') return t('vt.needOpen');
  return t('err.generic', { m: m || e });
}
function autoName(m) {
  const h = histAll().find(x => x.id === m.hid);
  return (h && h.name) || m.label || t('docs.untitled', { date: new Date(m.created).toLocaleDateString(locale()) });
}
function mapDocName(m) {
  const h = histAll().find(x => x.mapId === m.id);
  return (h && h.name) || m.label || t('docs.untitled', { date: new Date(m.created).toLocaleDateString(locale()) });
}
$('#save-map').addEventListener('click', async () => {
  if (!state.result) return;
  try {
    if (!(await ensureVaultOpen())) return;
    await vaultAdd(state.result.mapping);
    histUpsert({ id: state.histId, mapId: state.result.mapping.id });
    say('#m4', t('vt.saved'), 'ok');
    refreshMapChoices();
  } catch (e) { say('#m4', vaultErr(e), 'err'); }
});
function refreshMapChoices() {
  const box = $('#map-choices');
  if (window.pendingMap) { state.pinned = window.pendingMap; window.pendingMap = null; }
  const sel = state.pinned || (box.querySelector('input:checked') || {}).value;
  setTimeout(showRFiles, 0);
  const opts = [];
  if (state.result) opts.push({ v: 'session', t: t('rs.session', { doc: state.result.mapping.document, n: state.result.mapping.entries.length }) });
  let locked = false;
  if (vaultExists()) {
    if (vaultOpen()) for (const m of vaultList()) opts.push({ v: 'vault:' + m.id, t: t('rs.vaultItem', { doc: mapDocName(m), date: new Date(m.created).toLocaleString(locale()) }) });
    else locked = true;
  }
  const legacy = legacyTables();
  const sessId = state.result && state.result.mapping.id;
  for (const m of autoList()) if (m.id !== sessId) opts.push({ v: 'auto:' + m.id, t: t('rs.autoItem', { doc: autoName(m), date: new Date(m.created).toLocaleString(locale()) }) });
  for (const m of legacy) opts.push({ v: 'legacy:' + m.id, t: t('rs.legacyItem', { doc: m.document || t('doc.generic'), date: m.created ? new Date(m.created).toLocaleString(locale()) : '' }) });
  let html = opts.map((o, i) => `<label class="radio"><input type="radio" name="mapsrc" value="${esc(o.v)}"${(sel ? sel === o.v : i === 0) ? ' checked' : ''}> <span>${esc(o.t)}</span></label>`).join('');
  if (legacy.length) html += `<p class="hint">${esc(t('rs.legacyHint'))}</p>`;
  if (locked) html += `<div class="row"><span class="hint">${esc(t('rs.locked'))}</span><button type="button" class="btn sec" id="map-unlock">${esc(t('rs.unlock'))}</button></div>`;
  box.innerHTML = html ? `<label class="lbl">${esc(t('rs.table'))}</label>` + html : '';
}
$('#map-choices').addEventListener('click', async e => {
  if (e.target.id === 'map-unlock') { await ensureVaultOpen(); refreshMapChoices(); }
});
onVaultChange(() => refreshMapChoices());
refreshMapChoices();

/* ---- 5. Restauration : documents déposés + table retrouvée dans l'historique de l'appareil (ou fichier .json) ---- */
const DOC_EXT = ['pdf', 'docx', 'txt', 'md'];
async function fingerprint(text) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text).replace(/\s+/g, '').toLowerCase()));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return ''; }
}
async function readSource(f) {
  const ext = extOf(f), name = safeName(f.name.replace(/\.[^.]+$/, ''));
  if (ext === 'docx') { const ents = await unzip(await f.arrayBuffer()); return { kind: 'docx', name, ents, text: docxPartsText(ents) }; }
  if (ext === 'pdf') { const r = await pdfToText(await f.arrayBuffer()); return { kind: 'pdf', name, text: r.text }; }
  if (['txt', 'md'].includes(ext)) return { kind: 'txt', name, text: await f.text() };
  throw new Error(t('err.rfmt'));
}
function restoreSource(src, map) {
  const m = buildMatcher(map.entries.filter(e => e.values && e.values.length).map(e => ({ variants: [e.label], repl: e.values[0] })));
  const n = m.fn(src.text).length;
  if (src.kind === 'docx') { const ents = transformDocx(src.ents, m.fn, {}); return { n, d: { kind: 'docx', name: src.name, bytes: zip(ents), text: docxPartsText(ents) } }; }
  return { n, d: { kind: src.kind, name: src.name, text: applyMatches(src.text, m.fn(src.text)) } };
}
async function parseMapFile(f) {
  let map;
  try { map = JSON.parse(await f.text()); } catch (e) { throw new Error(t('err.maptype')); }
  if (!map || !Array.isArray(map.entries)) throw new Error(t('err.maptype'));
  return map;
}
/* Tables disponibles sur l'appareil (la table de la session, l'historique automatique, le coffre ouvert, l'ancienne version) */
async function candidateTables() {
  const out = [], sess = state.result && state.result.mapping;
  if (sess) out.push({ key: 'session', created: sess.created, load: async () => sess });
  for (const m of autoList()) if (!sess || m.id !== sess.id) out.push({ key: 'auto:' + m.id, created: m.created, label: autoName(m), load: () => autoGet(m.id) });
  if (vaultOpen()) for (const m of vaultList()) out.push({ key: 'vault:' + m.id, created: m.created, label: mapDocName(m), load: () => vaultGet(m.id) });
  for (const m of legacyTables()) out.push({ key: 'legacy:' + m.id, created: m.created || '', label: m.document || t('doc.generic'), load: async () => m });
  return out;
}
function labelScore(text, map) {
  const labels = map.entries.map(e => e.label).filter(Boolean);
  if (!labels.length) return 0;
  const found = new Set(buildMatcher([{ variants: labels, repl: 1 }]).fn(text).map(x => norm(text.slice(x.start, x.end))));
  return found.size;
}
/* Table la plus adaptée au texte : celle dont le plus de désignations y figurent ; à égalité, la plus récente */
async function bestTable(cands, text, force) {
  const scored = [];
  for (const c of cands) {
    let map = null;
    try { map = await c.load(); } catch (e) { map = null; }
    if (!map || !Array.isArray(map.entries)) continue;
    scored.push({ c, map, k: labelScore(text, map) });
  }
  const ok = scored.filter(x => x.k > 0 || (force && scored.length === 1));
  ok.sort((a, b) => b.k - a.k || String(b.c.created).localeCompare(String(a.c.created)));
  return ok.length ? { c: ok[0].c, map: ok[0].map, k: ok[0].k, more: ok.length - 1 } : null;
}
const hasAnyTable = () => !!(state.result || autoList().length || vaultList().length || legacyTables().length);
function showRFiles() {
  const rows = [];
  if (state.rMap) rows.push(['ok', t('rf.table', { f: state.rMap.name })]);
  for (const f of state.rDocs) rows.push(['ok', t('rf.doc', { f: f.name })]);
  if (state.rMap && !state.rDocs.length) rows.push(['warn', t('rf.needDoc')]);
  if (state.rDocs.length && !state.rMap && !hasAnyTable()) rows.push(['warn', t('rf.needTable')]);
  $('#r-status').innerHTML = rows.map(([c, x]) => `<div class="msg show ${c}">${esc(x)}</div>`).join('');
  $('#r-clear').hidden = !(state.rMap || state.rDocs.length);
}
$('#r-files').addEventListener('change', e => {
  for (const f of e.target.files) {
    const ext = extOf(f);
    if (ext === 'json') state.rMap = f;
    else if (DOC_EXT.includes(ext) && !state.rDocs.some(x => x.name === f.name && x.size === f.size)) state.rDocs.push(f);
  }
  e.target.value = '';
  showRFiles();
  if (state.rDocs.length && (state.rMap || hasAnyTable())) runRestore();
});
$('#r-clear').addEventListener('click', () => {
  state.rMap = null; state.rDocs = []; state.pinned = null; state.rResults = [];
  $('#r-out').innerHTML = ''; $('#r-out').hidden = true; say('#m5', ''); showRFiles();
});
function howText(r) {
  if (r.how === 'file') return t('rr.how.file');
  if (r.how === 'orig') return t('rr.how.orig', { f: r.ref });
  if (r.how === 'pinned') return t('rr.how.pinned', { doc: r.label || '', date: r.date });
  return t('rr.how.auto', { doc: r.label || '', date: r.date, k: r.k });
}
function renderRestoreResults(results) {
  const box = $('#r-out');
  box.innerHTML = ''; box.hidden = !results.length;
  state.rResults = results;
  results.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'rcard';
    const h = document.createElement('h3'); h.textContent = r.name; card.appendChild(h);
    if (r.none) {
      const w = document.createElement('div'); w.className = 'msg show warn'; w.textContent = t('rr.none'); card.appendChild(w);
      box.appendChild(card); return;
    }
    const note = document.createElement('p'); note.className = 'hint'; note.style.marginTop = '0'; note.textContent = howText(r); card.appendChild(note);
    if (r.more) { const w = document.createElement('div'); w.className = 'msg show warn'; w.textContent = t('rr.more', { n: r.more }); card.appendChild(w); }
    const pv = document.createElement('div'); pv.className = 'preview';
    const pre = document.createElement('pre'); if (i === 0) pre.id = 'r-preview';
    pre.textContent = previewHtml(r.d.text).slice(0, 8000) + (r.d.text.length > 8000 ? '\n\n' + t('s4.prevMore') : '');
    pv.appendChild(pre); card.appendChild(pv);
    const cp = document.createElement('div'); cp.className = 'row';
    const cb = document.createElement('button'); cb.type = 'button'; cb.className = 'btn sec r-copy'; cb.dataset.i = i; cb.textContent = t('rs.copy'); cp.appendChild(cb); card.appendChild(cp);
    const dl = document.createElement('div'); dl.className = 'row'; dl.style.marginTop = '4px'; if (i === 0) dl.id = 'r-dl'; card.appendChild(dl);
    box.appendChild(card);
    renderDownloads(dl, r.d, t('suffix.rest'), '#m5');
  });
}
$('#r-out').addEventListener('click', async e => {
  const b = e.target.closest('.r-copy');
  if (!b) return;
  const r = (state.rResults || [])[+b.dataset.i];
  if (!r || !r.d) return;
  try { await navigator.clipboard.writeText(r.d.text.replace(/\f/g, '\n\n')); say('#m5', t('rs.copied'), 'ok'); }
  catch (err) { say('#m5', t('err.copy'), 'warn'); }
});
let restoring = false;
async function runRestore() {
  if (restoring) return;
  restoring = true;
  try {
    say('#m5', t('msg.restoring'), 'ok busy');
    const mf = state.rMap || $('#r-map').files[0];
    const explicit = mf ? await parseMapFile(mf) : null;
    const files = state.rDocs.length ? state.rDocs.slice() : ($('#r-doc').files[0] ? [$('#r-doc').files[0]] : []);
    const sources = [];
    for (const f of files) sources.push(await readSource(f));
    for (const s of sources) { s.fp = await fingerprint(s.text); s.refs = autoFindFps(s.fp); }
    const refs = sources.filter(s => s.refs.length), fresh = sources.filter(s => !s.refs.length);
    const targets = (fresh.length ? fresh : sources).slice();
    const pasted = $('#r-paste').value;
    if (pasted.trim()) targets.push({ kind: 'txt', name: t('name.text'), text: pasted });
    if (!targets.length) throw new Error(t('err.rnone'));
    const cands = explicit ? [] : await candidateTables();
    const results = [];
    for (const s of targets) {
      let map = null, how = '', pick = null;
      if (explicit) { map = explicit; how = 'file'; }
      else {
        const pinned = state.pinned && cands.find(c => c.key === state.pinned);
        if (pinned) { try { map = await pinned.load(); } catch (e) { map = null; } if (map) { how = 'pinned'; pick = { c: pinned, k: labelScore(s.text, map), more: 0 }; } }
        if (!map && refs.length) {
          const rc = refs.flatMap(r => r.refs.map(x => ({ key: 'auto:' + x.id, created: x.created, label: autoName(x), refName: r.name, load: () => autoGet(x.id) })));
          pick = await bestTable(rc, s.text, true) || await bestTable(rc.slice(0, 1), '', true);
          if (pick) { map = pick.map; how = 'orig'; pick.refName = pick.c.refName; }
        }
        if (!map) {
          pick = await bestTable(cands, s.text, false);
          if (pick) { map = pick.map; how = 'auto'; }
        }
      }
      if (!map) { results.push({ name: s.name, none: true }); continue; }
      const r = restoreSource(s, map);
      results.push({ name: s.name, d: r.d, n: r.n, how, ref: pick && pick.refName, label: pick && pick.c.label, date: pick && pick.c.created ? new Date(pick.c.created).toLocaleDateString(locale()) : '', k: pick ? pick.k : 0, more: pick ? pick.more : 0, key: pick && pick.c.key });
    }
    renderRestoreResults(results);
    const used = results.find(r => r.key);
    if (used) { const radio = document.querySelector(`#map-choices input[value="${used.key}"]`); if (radio) radio.checked = true; }
    const done = results.filter(r => r.d), total = done.reduce((a, r) => a + r.n, 0);
    if (!done.length) say('#m5', t('rr.none'), 'warn');
    else if (done.length === 1) say('#m5', total ? t('msg.restored', { n: total }) : t('msg.restnone'), total ? 'ok' : 'warn');
    else say('#m5', t('msg.restoredMulti', { n: total, f: done.length }), total ? 'ok' : 'warn');
    logActivity('restore', { n: total });
  } catch (e) { say('#m5', t('err.generic', { m: e.message || e }), 'err'); }
  finally { restoring = false; }
}
$('#r-run').addEventListener('click', runRestore);
$('#map-choices').addEventListener('change', e => {
  if (e.target.name !== 'mapsrc') return;
  state.pinned = e.target.value;
  if (state.rDocs.length || $('#r-paste').value.trim() || $('#r-doc').files[0]) runRestore();
});

// Installation (PWA) : uniquement en HTTPS ou en local ; sans effet à l'ouverture directe du fichier.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
