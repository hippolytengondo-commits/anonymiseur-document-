/* ===== Interface ===== */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MIME = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain;charset=utf-8', pdf: 'application/pdf' };
const state = { kind: null, name: '', zip: null, text: '', media: 0, items: [], nextId: 1, result: null };

function say(id, text, cls) {
  const el = $(id);
  if (!text) { el.className = 'msg'; el.textContent = ''; return; }
  el.className = 'msg show ' + (cls || '');
  el.textContent = text;
}
function fmt(n) { return n.toLocaleString('fr-FR'); }
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
    s.onerror = () => rej(new Error('Module de génération PDF indisponible.'));
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
    if (e && e.name === 'PasswordException') throw new Error('Ce PDF est protégé par un mot de passe : retirez la protection avant de le charger.');
    throw new Error('PDF illisible ou corrompu.');
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
function outputsOf(d) {
  const L = [];
  const docxFn = async () => ({ data: d.kind === 'docx' ? d.bytes : buildDocxFromText(d.text), mime: MIME.docx });
  const pdfFn = async () => ({ data: await buildPdfFromText(d.text), mime: MIME.pdf });
  const txtFn = async () => ({ data: d.text.replace(/\f/g, '\n\n'), mime: MIME.txt });
  if (d.kind === 'docx') L.push(['Document Word (.docx)', 'docx', docxFn, true]);
  else if (d.kind === 'pdf') L.push(['Document PDF (.pdf)', 'pdf', pdfFn, true], ['Version Word (.docx)', 'docx', docxFn], ['Texte (.txt)', 'txt', txtFn]);
  else L.push(['Texte (.txt)', 'txt', txtFn, true]);
  return L;
}
function renderDownloads(box, d, suffix, msgSel) {
  box.innerHTML = '';
  for (const [label, ext, fn, primary] of outputsOf(d)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'btn' + (primary ? '' : ' sec'); b.textContent = label;
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await fn(); download(`${d.name}${suffix}.${ext}`, r.data, r.mime); }
      catch (e) { say(msgSel, 'Erreur : ' + (e.message || e), 'err'); }
      b.disabled = false;
    });
    box.appendChild(b);
  }
}
const previewHtml = t => t.replace(/\f/g, '\n\n— — —\n\n');

/* ---- 1. Chargement ---- */
function resetAnalysis() {
  state.items = []; state.result = null;
  $('#s3').hidden = true; $('#s4').hidden = true;
  say('#m2', ''); say('#m3', '');
}
async function onFile(file) {
  if (!file) return;
  resetAnalysis();
  const ext = extOf(file);
  try {
    say('#m1', 'Lecture du document…', 'ok');
    if (ext === 'doc') throw new Error("L'ancien format .doc n'est pas pris en charge. Enregistrez le document au format .docx ou PDF.");
    let pagesInfo = '';
    if (ext === 'pdf') {
      const r = await pdfToText(await file.arrayBuffer());
      if (r.text.replace(/\s/g, '').length < 20 * r.pages)
        throw new Error("Ce PDF ne contient pas de texte exploitable : il s'agit probablement d'un document numérisé (image). La reconnaissance de caractères (OCR) n'est pas disponible dans cette version.");
      state.kind = 'pdf'; state.zip = null; state.text = r.text; state.media = 0;
      pagesInfo = `${r.pages} page(s), `;
    } else if (ext === 'docx') {
      const ents = await unzip(await file.arrayBuffer());
      if (!ents.some(e => e.name === 'word/document.xml')) throw new Error('Document Word invalide.');
      state.kind = 'docx'; state.zip = ents; state.text = docxPartsText(ents);
      state.media = ents.filter(e => /^word\/media\//.test(e.name)).length;
    } else if (['txt', 'md', 'csv'].includes(ext)) {
      state.kind = 'txt'; state.zip = null; state.text = await file.text(); state.media = 0;
    } else throw new Error('Format non pris en charge. Utilisez un fichier PDF, .docx ou .txt.');
    state.name = file.name.replace(/\.[^.]+$/, '');
    let info = `« ${file.name} » chargé — ${pagesInfo}${fmt(state.text.length)} caractères.`;
    let cls = 'ok';
    if (state.media) { info += ` Attention : ${state.media} image(s) intégrée(s) ; leur contenu n'est pas anonymisé.`; cls = 'warn'; }
    if (!state.text.trim()) { info = 'Aucun texte exploitable trouvé dans ce document.'; cls = 'err'; state.kind = null; }
    say('#m1', info, cls);
  } catch (e) {
    state.kind = null;
    say('#m1', e.message || String(e), 'err');
  }
}
$('#file').addEventListener('change', e => onFile(e.target.files[0]));
$('#use-paste').addEventListener('click', () => {
  const t = $('#paste').value;
  if (!t.trim()) return say('#m1', 'Aucun texte à utiliser.', 'err');
  resetAnalysis();
  state.kind = 'txt'; state.zip = null; state.text = t; state.name = 'texte'; state.media = 0;
  say('#m1', `Texte chargé — ${fmt(t.length)} caractères.`, 'ok');
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
  if (!state.kind || !state.text.trim()) return say('#m2', "Veuillez d'abord charger un document (étape 1).", 'err');
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
    id: $('#o-id').checked, iban: $('#o-iban').checked, url: $('#o-url').checked, amount: $('#o-amount').checked, date: $('#o-date').checked
  };
  const order = Object.keys(TYPES);
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
  say('#m2', state.items.length ? `${state.items.length} élément(s) à contrôler (${found} trouvé(s) dans le document).` : "Aucun élément détecté. Saisissez-les manuellement ci-dessus, ou ajoutez-en à l'étape 3.", state.items.length ? 'ok' : 'warn');
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
    it.auto = formatLabel(it.type, cnt[it.type]);
  }
  for (const it of state.items) if (!it.include && !it.auto) it.auto = (TYPES[it.type] || TYPES.other).base;
}
function countText(it) { return it.count ? `${it.count} occurrence${it.count > 1 ? 's' : ''}` : 'non trouvé'; }

function renderItems() {
  const typeOpts = k => Object.entries(TYPES).map(([t, v]) => `<option value="${t}"${t === k ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
  $('#items').innerHTML = state.items.map(it => `
<div class="item${it.include ? '' : ' off'}" data-id="${it.id}">
  <div class="item-top">
    <input type="checkbox" class="f-inc" aria-label="Masquer cet élément"${it.include ? ' checked' : ''}>
    <select class="f-type" aria-label="Type">${typeOpts(it.type)}</select>
    <span class="badge cnt">${countText(it)}</span>
    ${it.conf === 'medium' ? '<span class="badge warn">À vérifier</span>' : ''}
    <button class="x f-del" type="button" title="Supprimer" aria-label="Supprimer">×</button>
  </div>
  <div><label class="lbl">Texte à masquer <small>(variantes séparées par « | »)</small></label>
  <input type="text" class="f-var" value="${esc(it.variants.join(' | '))}"></div>
  <div><label class="lbl">Remplacer par</label>
  <input type="text" class="f-lab" value="${esc(it.custom)}" placeholder="${esc(it.auto)}"></div>
</div>`).join('') || '<p class="hint">Aucun élément. Utilisez le formulaire ci-dessous pour en ajouter.</p>';
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

$('#add-type').innerHTML = Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${k === 'other' ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
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

/* ---- 4. Anonymisation ---- */
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
  return { format: 'anonymiseur-v1', id: 'm' + Date.now().toString(36), created: new Date().toISOString(), document: state.name, entries: [...g.values()] };
}
function run() {
  try {
    computeStats();
    const active = state.items.filter(i => i.include && i.variants.length);
    if (!active.length) { say('#m3', 'Aucun élément sélectionné.', 'err'); return false; }
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
    state.result = { d, mapping };

    $('#stats').innerHTML =
      `<div class="stat"><b>${fmt(total)}</b>remplacements</div>` +
      `<div class="stat"><b>${mapping.entries.length}</b>désignations</div>` +
      `<div class="stat"><b style="color:${left ? 'var(--bad)' : 'var(--ok)'}">${left}</b>occurrence(s) résiduelle(s)</div>`;
    const labels = mapping.entries.map(e => e.label);
    const shown = previewHtml(d.text).slice(0, 8000);
    $('#preview').innerHTML = highlight(shown, labels) + (d.text.length > 8000 ? '\n\n… (aperçu limité aux premiers caractères)' : '');
    const labelWords = new Set(labels.flatMap(l => l.toLowerCase().split(/[\s\[\]\d]+/)).filter(Boolean));
    const res = residualWords(d.text, labelWords, 40);
    $('#residual').innerHTML = res.length
      ? res.map(r => `<button type="button" class="chip" data-w="${esc(r.word)}">${esc(r.word)}<i>×${r.total}</i></button>`).join('')
      : '<span class="hint">Aucun mot à majuscule suspect.</span>';
    renderDownloads($('#dl-box'), d, '_anonymise', '#m4');
    say('#m4', '');
    $('#s4').hidden = false;
    say('#m3', '');
    refreshMapChoices();
    return true;
  } catch (e) { say('#m3', 'Erreur : ' + (e.message || e), 'err'); return false; }
}
$('#run').addEventListener('click', () => { if (run()) $('#s4').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
$('#residual').addEventListener('click', e => {
  const b = e.target.closest('.chip');
  if (!b) return;
  addItem('other', [b.dataset.w]);
  run();
});
$('#dl-json').addEventListener('click', () => state.result && download(`${baseName()}_correspondances.json`, JSON.stringify(state.result.mapping, null, 2), 'application/json'));
$('#dl-csv').addEventListener('click', () => {
  if (!state.result) return;
  const q = s => '"' + String(s).replace(/"/g, '""') + '"';
  const rows = [['Désignation', 'Type', "Valeurs d'origine"].map(q).join(';')];
  for (const e of state.result.mapping.entries) rows.push([e.label, (TYPES[e.type] || TYPES.other).name, e.values.join(' | ')].map(q).join(';'));
  download(`${baseName()}_correspondances.csv`, '﻿' + rows.join('\r\n'), 'text/csv;charset=utf-8');
});

/* ---- Tables mémorisées (facultatif, navigateur uniquement) ---- */
const STORE_KEY = 'anonymiseur_tables_v1';
function loadSaved() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch (e) { return []; } }
function writeSaved(list) { localStorage.setItem(STORE_KEY, JSON.stringify(list)); }
$('#save-map').addEventListener('click', () => {
  if (!state.result) return;
  try {
    const list = loadSaved().filter(m => m.document !== state.result.mapping.document);
    list.unshift(state.result.mapping);
    writeSaved(list.slice(0, 30));
    say('#m4', 'Table mémorisée sur cet appareil. Elle sera proposée à l\'étape 5. Conservez tout de même le fichier .json.', 'ok');
    refreshMapChoices();
  } catch (e) { say('#m4', "Impossible de mémoriser ici (stockage du navigateur indisponible). Utilisez le fichier .json.", 'err'); }
});
function refreshMapChoices() {
  const box = $('#map-choices');
  const sel = (box.querySelector('input:checked') || {}).value;
  const opts = [];
  if (state.result) opts.push({ v: 'session', t: `Session en cours — ${state.result.mapping.document} (${state.result.mapping.entries.length} désignations)` });
  for (const m of loadSaved()) opts.push({ v: 'saved:' + m.id, t: `Mémorisée — ${m.document} (${new Date(m.created).toLocaleString('fr-FR')})`, del: m.id });
  if (!opts.length) { box.innerHTML = '<p class="hint" style="margin:0">Aucune table disponible sur cet appareil : chargez le fichier .json ci-dessous.</p>'; return; }
  box.innerHTML = opts.map((o, i) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><label style="flex:1;font-size:14px;display:flex;gap:8px;align-items:center"><input type="radio" name="mapsrc" value="${esc(o.v)}"${(sel ? sel === o.v : i === 0) ? ' checked' : ''}> ${esc(o.t)}</label>${o.del ? `<button type="button" class="x" data-del="${esc(o.del)}" title="Supprimer cette table">×</button>` : ''}</div>`).join('');
}
$('#map-choices').addEventListener('click', e => {
  const id = e.target.dataset && e.target.dataset.del;
  if (!id) return;
  try { writeSaved(loadSaved().filter(m => m.id !== id)); } catch (err) { /* ignore */ }
  refreshMapChoices();
});
refreshMapChoices();

/* ---- 5. Restauration ---- */
async function getMapping() {
  const f = $('#r-map').files[0];
  if (f) {
    const map = JSON.parse(await f.text());
    if (!map || !Array.isArray(map.entries)) throw new Error('Table de correspondance invalide.');
    return map;
  }
  const c = $('#map-choices input:checked');
  if (c) {
    if (c.value === 'session') return state.result.mapping;
    const m = loadSaved().find(x => 'saved:' + x.id === c.value);
    if (m) return m;
  }
  throw new Error('Sélectionnez ou chargez une table de correspondance.');
}
$('#r-run').addEventListener('click', async () => {
  try {
    say('#m5', 'Restauration en cours…', 'ok');
    const map = await getMapping();
    const matcher = buildMatcher(map.entries.filter(e => e.values && e.values.length).map(e => ({ variants: [e.label], repl: e.values[0] })));
    const f = $('#r-doc').files[0], pasted = $('#r-paste').value;
    let d;
    if (f) {
      const ext = extOf(f), base = safeName(f.name.replace(/\.[^.]+$/, ''));
      if (ext === 'docx') {
        const ents = transformDocx(await unzip(await f.arrayBuffer()), matcher.fn, {});
        d = { kind: 'docx', name: base, bytes: zip(ents), text: docxPartsText(ents) };
      } else if (ext === 'pdf') {
        const r = await pdfToText(await f.arrayBuffer());
        d = { kind: 'pdf', name: base, text: applyMatches(r.text, matcher.fn(r.text)) };
      } else if (['txt', 'md'].includes(ext)) {
        const t = await f.text();
        d = { kind: 'txt', name: base, text: applyMatches(t, matcher.fn(t)) };
      } else throw new Error('Format non pris en charge (.pdf, .docx ou .txt).');
    } else if (pasted.trim()) {
      d = { kind: 'txt', name: 'texte', text: applyMatches(pasted, matcher.fn(pasted)) };
    } else throw new Error('Chargez un document ou collez un texte à restaurer.');
    const n = matcher.fn(f ? (d.kind === 'docx' ? docxPartsText(await unzip(await f.arrayBuffer())) : (d.kind === 'pdf' ? (await pdfToText(await f.arrayBuffer())).text : await f.text())) : pasted).length;
    $('#r-preview').textContent = previewHtml(d.text).slice(0, 8000) + (d.text.length > 8000 ? '\n\n… (aperçu limité aux premiers caractères)' : '');
    $('#r-out').hidden = false;
    state.restored = d;
    renderDownloads($('#r-dl'), d, '_restaure', '#m5');
    say('#m5', n ? `${n} désignation(s) remplacée(s) par les valeurs d'origine.` : "Aucune désignation de la table n'a été retrouvée dans ce document.", n ? 'ok' : 'warn');
  } catch (e) { say('#m5', 'Erreur : ' + (e.message || e), 'err'); }
});
$('#r-copy').addEventListener('click', async () => {
  if (!state.restored) return;
  try { await navigator.clipboard.writeText(state.restored.text.replace(/\f/g, '\n\n')); say('#m5', 'Texte copié.', 'ok'); }
  catch (e) { say('#m5', 'Copie impossible : sélectionnez le texte manuellement.', 'warn'); }
});

// Installation (PWA) : uniquement en HTTPS ou en local ; sans effet à l'ouverture directe du fichier.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) { navigator.serviceWorker.register('sw.js').catch(() => {}); }
