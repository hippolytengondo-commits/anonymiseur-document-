/* ===== Coque d'application : navigation, espaces et fenêtres ===== */
const ICONS = {
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 010 12h-3"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9"/><path d="M16 7l3 3"/><path d="M14 9l2 2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  badge: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>'
};
const ico = n => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n]}</svg>`;
const NAV = [
  { id: 'dashboard', icon: 'home', tab: 'tab.dashboard' },
  { id: 'anonymize', icon: 'shield', tab: 'tab.anonymize' },
  { id: 'restore', icon: 'undo' },
  { id: 'documents', icon: 'file', tab: 'tab.documents' },
  { id: 'vault', icon: 'key', tab: 'tab.vault' },
  { id: 'activity', icon: 'list' },
  { id: 'security', icon: 'lock' },
  { id: 'plans', icon: 'badge' },
  { id: 'profile', icon: 'user' }
];
let current = 'dashboard', firstRoute = true;
const fmtDate = ts => new Date(ts).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
const noticeHtml = (txt, cls) => `<div class="notice ${cls || 'info'}"><div>${esc(txt)}</div></div>`;

function toast(msg, cls) {
  const el = document.createElement('div');
  el.className = 'toast ' + (cls || '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4800);
}

/* ---- Navigation ---- */
function buildNav() {
  $('#nav').innerHTML = NAV.map(n => `<a href="#/${n.id}" data-nav="${n.id}">${ico(n.icon)}<span>${esc(t('nav.' + n.id))}</span></a>`).join('');
  $('#tabbar').innerHTML = NAV.filter(n => n.tab).map(n => `<a href="#/${n.id}" data-nav="${n.id}">${ico(n.icon)}<span>${esc(t(n.tab))}</span></a>`).join('')
    + `<button type="button" id="more-btn" aria-expanded="false" aria-controls="sheet">${ico('more')}<span>${esc(t('nav.more'))}</span></button>`;
  $('#sheet').innerHTML = NAV.filter(n => !n.tab).map(n => `<a href="#/${n.id}" data-nav="${n.id}">${ico(n.icon)}<span>${esc(t('nav.' + n.id))}</span></a>`).join('');
  markNav();
}
function markNav() {
  document.querySelectorAll('[data-nav]').forEach(a => { if (a.dataset.nav === current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const more = $('#more-btn');
  if (more) { if (NAV.some(n => n.id === current && !n.tab)) more.setAttribute('aria-current', 'page'); else more.removeAttribute('aria-current'); }
}
function closeSheet() { $('#sheet').hidden = true; const m = $('#more-btn'); if (m) m.setAttribute('aria-expanded', 'false'); }
document.addEventListener('click', e => {
  const mb = e.target.closest('#more-btn');
  if (mb) { const open = $('#sheet').hidden; $('#sheet').hidden = !open; mb.setAttribute('aria-expanded', String(open)); return; }
  if (!$('#sheet').hidden && !e.target.closest('#sheet')) closeSheet();
  const lg = e.target.closest('[data-lang]');
  if (lg) applyLang(lg.dataset.lang);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
function show(id) {
  current = NAV.some(n => n.id === id) ? id : 'dashboard';
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== current; });
  markNav(); closeSheet();
  renderView(current);
  const ttl = t('nav.' + current);
  $('#topbar-title').textContent = ttl;
  document.title = ttl + ' — ANONYX';
  window.scrollTo(0, 0);
}
function route() {
  const m = location.hash.match(/^#\/(\w+)/);
  show(m ? m[1] : 'dashboard');
  if (!firstRoute) $('#main').focus({ preventScroll: true });
  firstRoute = false;
}
function go(id) { if (location.hash === '#/' + id) route(); else location.hash = '#/' + id; }
window.addEventListener('hashchange', route);

function renderView(id) {
  if (id === 'dashboard') renderDashboard();
  else if (id === 'documents') renderDocuments();
  else if (id === 'vault') renderVault();
  else if (id === 'activity') renderActivity();
  else if (id === 'security') renderSecurity();
  else if (id === 'profile') renderProfile();
  else if (id === 'restore') refreshMapChoices();
}

/* ---- Fenêtres modales ---- */
let lastFocus = null, modalDone = null;
function closeModal(result) {
  $('#modal').innerHTML = '';
  document.removeEventListener('keydown', modalKeys, true);
  if (lastFocus && lastFocus.focus) lastFocus.focus();
  const d = modalDone; modalDone = null;
  if (d) d(result);
}
function modalKeys(e) {
  const box = $('#modal .modal');
  if (!box) return;
  if (e.key === 'Escape') { e.preventDefault(); closeModal(false); return; }
  if (e.key !== 'Tab') return;
  const f = [...box.querySelectorAll('button:not([disabled]),input,select,textarea,a[href]')];
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
function openModal(html) {
  lastFocus = document.activeElement;
  $('#modal').innerHTML = `<div class="modal-back"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="md-t">${html}</div></div>`;
  document.addEventListener('keydown', modalKeys, true);
  return new Promise(res => { modalDone = res; });
}
function confirmDialog(message, okLabel, danger) {
  const p = openModal(`<h2 id="md-t">${esc(okLabel)}</h2><p>${esc(message)}</p>
    <div class="row"><button class="btn${danger ? ' danger' : ''}" id="md-ok" type="button">${esc(okLabel)}</button><button class="btn sec" id="md-cancel" type="button">${esc(t('common.cancel'))}</button></div>`);
  $('#md-ok').addEventListener('click', () => closeModal(true));
  $('#md-cancel').addEventListener('click', () => closeModal(false));
  $('#md-cancel').focus();
  return p;
}
function passDialog(mode) {
  const title = mode === 'create' ? t('pp.createTitle') : mode === 'change' ? t('pp.changeTitle') : t('pp.unlockTitle');
  const field = (id, label, auto) => `<label class="lbl" for="${id}">${esc(label)}</label><input type="password" id="${id}" autocomplete="${auto}">`;
  let f = '';
  if (mode === 'create') f = field('pp-pass', t('pp.label'), 'new-password') + field('pp-confirm', t('pp.confirm'), 'new-password');
  else if (mode === 'change') f = field('pp-pass', t('pp.old'), 'current-password') + field('pp-new', t('pp.new'), 'new-password') + field('pp-confirm', t('pp.confirm'), 'new-password');
  else f = field('pp-pass', t('pp.label'), 'current-password');
  const help = mode === 'unlock' ? '' : `<p class="hint">${esc(t('pp.help'))}</p>`;
  const intro = mode === 'create' ? `<p class="hint" style="margin:0 0 4px">${esc(t('vt.none.b'))}</p>` : '';
  const p = openModal(`<h2 id="md-t">${esc(title)}</h2>${intro}<form id="pp-form" novalidate>${f}${help}
    <div class="msg" id="pp-err" role="alert"></div>
    <div class="row"><button class="btn" id="pp-ok" type="submit">${esc(t('pp.ok'))}</button><button class="btn sec" id="pp-cancel" type="button">${esc(t('common.cancel'))}</button></div></form>`);
  $('#pp-cancel').addEventListener('click', () => closeModal(false));
  $('#pp-pass').focus();
  $('#pp-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const val = id => ($('#' + id) ? $('#' + id).value : '');
    const err = k => { const el = $('#pp-err'); el.className = 'msg show err'; el.textContent = t(k); };
    const pass = val('pp-pass'), np = mode === 'change' ? val('pp-new') : pass;
    if (!pass) return err(mode === 'unlock' ? 'vt.badpass' : 'pp.short');
    if (mode !== 'unlock') {
      if (np.length < 10) return err('pp.short');
      if (np !== val('pp-confirm')) return err('pp.mismatch');
    }
    const ok = $('#pp-ok'); ok.disabled = true;
    const w = $('#pp-err'); w.className = 'msg show ok busy'; w.textContent = t('pp.working');
    try {
      if (mode === 'create') {
        const n = await vaultCreate(pass);
        toast(t('vt.created'), 'ok');
        if (n) toast(t('vt.migrated', { n }), 'ok');
      } else if (mode === 'unlock') {
        const r = await vaultUnlock(pass);
        if (r === false) { ok.disabled = false; return err('vt.badpass'); }
        toast(t('vt.unlocked'), 'ok');
        if (typeof r === 'number' && r) toast(t('vt.migrated', { n: r }), 'ok');
      } else {
        const r = await vaultChangePass(pass, np);
        if (r === false) { ok.disabled = false; return err('vt.badpass'); }
        toast(t('vt.changed'), 'ok');
      }
      closeModal(true);
    } catch (e) {
      ok.disabled = false;
      const el = $('#pp-err'); el.className = 'msg show err'; el.textContent = vaultErr(e);
    }
  });
  return p;
}
async function ensureVaultOpen() {
  if (vaultOpen()) return true;
  return passDialog(vaultExists() ? 'unlock' : 'create');
}

/* ---- Données d'affichage ---- */
const docTitle = h => h.name || t('docs.untitled', { date: fmtDate(h.ts) });
const docStatus = h => (h.mapId && vaultList().some(m => m.id === h.mapId) ? 'table' : 'none');
function evText(e) {
  const d = Object.assign({}, e.data || {});
  if (d.kind) d.kind = t('kind.' + d.kind);
  if (d.fmt) d.fmt = String(d.fmt).toUpperCase();
  const key = 'ev.' + e.type;
  return I18N.fr[key] === undefined ? e.type : t(key, d);
}
function docItem(h, withActions) {
  const st = docStatus(h);
  const acts = withActions
    ? (st === 'table' ? `<button class="btn sec sm" type="button" data-act="restore" data-id="${esc(h.id)}">${esc(t('docs.restore'))}</button><button class="btn sec sm" type="button" data-act="table" data-id="${esc(h.id)}">${esc(t('docs.table'))}</button>` : '')
      + `<button class="btn sec sm" type="button" data-act="del" data-id="${esc(h.id)}">${esc(t('common.delete'))}</button>`
    : '';
  return `<li><div><div class="t">${esc(docTitle(h))}</div><div class="m">${esc(fmtDate(h.ts))} · ${esc(h.kind ? t('kind.' + h.kind) : '')} · ${esc(t('docs.meta', { r: h.replacements || 0, n: h.designations || 0 }))}</div></div>
  <div class="row" style="margin:0"><span class="badge ${st === 'table' ? 'ok' : 'soon'}">${esc(t('status.' + st))}</span>${acts}</div></li>`;
}
function emptyText(kind) { return prefs.history ? t(kind) : t('empty.off'); }

/* ---- Tableau de bord ---- */
async function offlineReady() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return false;
  try { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); } catch (e) { return false; }
}
async function renderDashboard() {
  const name = (prefs.name || '').trim();
  $('#dash-hello').textContent = name ? t('dash.hello', { name }) : t('dash.hello0');
  const hist = histAll(), act = actAll();
  const repl = hist.reduce((s, h) => s + (h.replacements || 0), 0);
  const last = act[0];
  $('#kpis').innerHTML =
    `<div class="kpi"><small>${esc(t('kpi.docs'))}</small><b>${fmt(hist.length)}</b></div>` +
    `<div class="kpi"><small>${esc(t('kpi.repl'))}</small><b>${fmt(repl)}</b></div>` +
    `<div class="kpi"><small>${esc(t('kpi.tables'))}</small><b>${fmt(vaultList().length)}</b></div>` +
    `<div class="kpi"><small>${esc(t('kpi.last'))}</small>${last ? `<b class="sm">${esc(evText(last))}</b><small>${esc(fmtDate(last.ts))}</small>` : `<b class="sm">${esc(t('kpi.never'))}</b>`}</div>`;
  const vs = vaultExists() ? (vaultOpen() ? 'vault.open' : 'vault.locked') : 'vault.none';
  const off = await offlineReady();
  $('#prot').innerHTML =
    `<li><span>${esc(t('prot.local'))}</span><span>${esc(t('prot.localV'))}</span></li>` +
    `<li><span>${esc(t('prot.vault'))}</span><span>${esc(t(vs))}</span></li>` +
    `<li><span>${esc(t('prot.offline'))}</span><span>${esc(t(off ? 'off.yes' : 'off.no'))}</span></li>` +
    `<li><span>${esc(t('prot.sync'))}</span><span>${esc(t('prot.syncV'))}</span></li>`;
  $('#dash-docs').innerHTML = hist.length ? `<ul class="list">${hist.slice(0, 4).map(h => docItem(h, false)).join('')}</ul>` : `<p class="empty">${esc(emptyText('empty.docs'))}</p>`;
  $('#dash-act').innerHTML = act.length ? `<ul class="list">${act.slice(0, 5).map(e => `<li><span>${esc(evText(e))}</span><span class="m">${esc(fmtDate(e.ts))}</span></li>`).join('')}</ul>` : `<p class="empty">${esc(emptyText('empty.act'))}</p>`;
}

/* ---- Mes documents ---- */
function renderDocuments() {
  const hist = histAll();
  const selS = $('#doc-status'), selK = $('#doc-kind');
  const vs = selS.value || 'all', vk = selK.value || 'all';
  selS.innerHTML = `<option value="all">${esc(t('docs.fAll'))}</option><option value="table">${esc(t('docs.fTable'))}</option><option value="none">${esc(t('docs.fNo'))}</option>`;
  const kinds = [...new Set(hist.map(h => h.kind).filter(Boolean))];
  selK.innerHTML = `<option value="all">${esc(t('docs.fKind'))}</option>` + kinds.map(k => `<option value="${esc(k)}">${esc(t('kind.' + k))}</option>`).join('');
  selS.value = vs; selK.value = kinds.includes(vk) ? vk : 'all';
  const q = $('#doc-q').value.trim().toLowerCase();
  const rows = hist.filter(h => (selS.value === 'all' || docStatus(h) === selS.value) && (selK.value === 'all' || h.kind === selK.value) && (!q || docTitle(h).toLowerCase().includes(q)));
  $('#doc-list').innerHTML = rows.length ? `<ul class="list">${rows.map(h => docItem(h, true)).join('')}</ul>`
    : `<p class="empty">${esc(hist.length ? t('docs.noMatch') : emptyText('empty.docs'))}</p>`;
}
['#doc-q', '#doc-status', '#doc-kind'].forEach(s => $(s).addEventListener('input', renderDocuments));
$('#doc-list').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const h = histAll().find(x => x.id === b.dataset.id);
  if (!h) return;
  if (b.dataset.act === 'restore') { window.pendingMap = 'vault:' + h.mapId; go('restore'); }
  else if (b.dataset.act === 'table') { window.focusMap = h.mapId; go('vault'); }
  else if (b.dataset.act === 'del' && await confirmDialog(t('docs.confirmDel'), t('common.delete'), true)) { histDelete(h.id); renderDocuments(); }
});

/* ---- Correspondances (coffre) ---- */
function vaultMsg(txt, cls) { say('#m-vault', txt, cls); }
function renderVault() {
  const legacy = legacyTables().length;
  let html = legacy ? noticeHtml(t('vt.legacy', { n: legacy })) : '';
  if (!vaultExists()) {
    html += `<div class="card"><h2>${ico('key')} ${esc(t('vt.none.t'))}</h2><p>${esc(t('vt.none.b'))}</p><div class="row"><button class="btn" type="button" data-vt="create">${esc(t('vt.create'))}</button></div></div>`;
  } else if (!vaultOpen()) {
    html += `<div class="card"><h2>${ico('lock')} ${esc(t('vt.locked.t'))}</h2><p>${esc(t('vt.locked.b'))}</p><div class="row"><button class="btn" type="button" data-vt="unlock">${esc(t('vt.unlock'))}</button></div></div>`;
  } else {
    const items = vaultList();
    html += `<div class="row" style="margin:0 0 14px"><button class="btn sec" type="button" data-vt="lock">${esc(t('vt.lock'))}</button><button class="btn sec" type="button" data-vt="change">${esc(t('vt.change'))}</button><button class="btn sec" type="button" data-vt="import">${esc(t('vt.import'))}</button><input type="file" id="vault-import" accept=".json,application/json" hidden></div>`;
    html += items.length ? items.map(m => `<div class="vcard${window.focusMap === m.id ? ' hl' : ''}" data-id="${esc(m.id)}"><div class="t" style="font-weight:600;overflow-wrap:anywhere">${esc(mapDocName(m))}</div>
      <div class="m" style="font-size:13.5px;color:var(--muted)">${esc(fmtDate(new Date(m.created).getTime()))} · ${esc(t('vt.count', { n: m.count }))}</div>
      <div class="row" style="margin-top:10px"><button class="btn sec sm" type="button" data-vt="reveal">${esc(t('vt.reveal'))}</button><button class="btn sec sm" type="button" data-vt="json">JSON</button><button class="btn sec sm" type="button" data-vt="csv">CSV</button><button class="btn sec sm" type="button" data-vt="use">${esc(t('vt.use'))}</button><button class="btn sec sm" type="button" data-vt="del">${esc(t('common.delete'))}</button></div>
      <div class="vals" hidden></div></div>`).join('') : `<div class="card"><p class="empty">${esc(t('vt.empty'))}</p></div>`;
  }
  $('#vault-body').innerHTML = html;
  const hl = $('#vault-body .vcard.hl');
  if (hl) { hl.scrollIntoView({ block: 'center' }); window.focusMap = null; }
}
$('#vault-body').addEventListener('click', async e => {
  const b = e.target.closest('[data-vt]');
  if (!b) return;
  const act = b.dataset.vt, card = b.closest('.vcard'), id = card && card.dataset.id;
  try {
    if (act === 'create') await passDialog('create');
    else if (act === 'unlock') await passDialog('unlock');
    else if (act === 'lock') { vaultLock(); toast(t('vt.lockedMsg')); }
    else if (act === 'change') await passDialog('change');
    else if (act === 'import') $('#vault-import').click();
    else if (act === 'reveal') {
      const box = $('.vals', card);
      if (!box.hidden) { box.hidden = true; box.textContent = ''; b.textContent = t('vt.reveal'); return; }
      const m = await vaultGet(id);
      box.innerHTML = (m ? m.entries : []).map(x => `<div><b>${esc(x.label)}</b> → ${esc((x.values || []).join(' | '))}</div>`).join('');
      box.hidden = false; b.textContent = t('vt.hide');
    } else if (act === 'json' || act === 'csv') {
      const m = await vaultGet(id);
      if (m) exportMap(m, act, mapDocName(vaultList().find(x => x.id === id) || {}));
    } else if (act === 'use') { window.pendingMap = 'vault:' + id; go('restore'); }
    else if (act === 'del' && await confirmDialog(t('vt.delConfirm'), t('common.delete'), true)) vaultDelete(id);
  } catch (err) { vaultMsg(vaultErr(err), 'err'); }
});
$('#vault-body').addEventListener('change', async e => {
  if (e.target.id !== 'vault-import') return;
  const f = e.target.files[0];
  if (!f) return;
  try {
    const m = JSON.parse(await f.text());
    if (!m || !Array.isArray(m.entries)) throw new Error(t('err.maptype'));
    if (!m.id) m.id = 'm' + Date.now().toString(36);
    if (!m.created) m.created = new Date().toISOString();
    await vaultAdd(m, true); logActivity('vaultImport');
    vaultMsg(t('vt.imported'), 'ok');
  } catch (err) { vaultMsg(vaultErr(err), 'err'); }
  e.target.value = '';
});

/* ---- Activités ---- */
function renderActivity() {
  const act = actAll();
  $('#act-list').innerHTML = act.length ? `<ul class="list">${act.map(e => `<li><span>${esc(evText(e))}</span><span class="m">${esc(fmtDate(e.ts))}</span></li>`).join('')}</ul>` : `<p class="empty">${esc(emptyText('empty.act'))}</p>`;
  $('#act-actions').hidden = !act.length;
}
$('#act-clear').addEventListener('click', async () => {
  if (await confirmDialog(t('sec.clearHistConfirm'), t('act.clear'), true)) { clearHistory(); renderActivity(); }
});

/* ---- Sécurité et confidentialité ---- */
function renderSecurity() {
  const hist = histAll().length, act = actAll().length, tabs = vaultList().length, legacy = legacyTables().length;
  const vs = vaultExists() ? (vaultOpen() ? 'vault.open' : 'vault.locked') : 'vault.none';
  const opts = [5, 10, 30, 60].map(n => `<option value="${n}"${+prefs.lockMin === n ? ' selected' : ''}>${esc(t('sec.min', { n }))}</option>`).join('');
  const row = (k, v) => `<li><span>${esc(k)}</span><span>${esc(v)}</span></li>`;
  $('#sec-body').innerHTML = `
  <div class="card"><h2>${ico('shield')} ${esc(t('sec.local.t'))}</h2><p style="margin:0">${esc(t('sec.local.b'))}</p></div>
  <div class="card"><h2>${ico('key')} ${esc(t('sec.vault.t'))} <span class="badge ${vaultOpen() ? 'ok' : 'soon'}">${esc(t(vs))}</span></h2><p>${esc(t('sec.vault.b'))}</p>
    <label class="lbl" for="sec-lock">${esc(t('sec.lockDelay'))}</label><select id="sec-lock">${opts}</select>
    <div class="row"><button class="btn sec" type="button" data-sec="lock"${vaultOpen() ? '' : ' disabled'}>${esc(t('sec.lockNow'))}</button></div></div>
  <div class="card"><h2>${esc(t('sec.opt.t'))}</h2>
    <label class="switch"><input type="checkbox" id="sec-hist"${prefs.history ? ' checked' : ''}><span><b>${esc(t('sec.optHist'))}</b><span class="hint">${esc(t('sec.optHistH'))}</span></span></label>
    <label class="switch"><input type="checkbox" id="sec-names"${prefs.keepNames ? ' checked' : ''}><span><b>${esc(t('sec.optNames'))}</b><span class="hint">${esc(t('sec.optNamesH'))}</span></span></label></div>
  <div class="card"><h2>${esc(t('sec.data.t'))}</h2><ul class="status">${row(t('sec.hist'), t('sec.items', { n: hist }))}${row(t('sec.log'), t('sec.items', { n: act }))}${row(t('sec.tables'), t('sec.items', { n: tabs }))}${legacy ? row(t('sec.legacy'), t('sec.items', { n: legacy })) : ''}</ul>
    <div class="row"><button class="btn sec" type="button" data-sec="clearhist">${esc(t('sec.clearHist'))}</button></div></div>
  <div class="card"><h2>${esc(t('sec.sess.t'))}</h2><p style="margin:0">${esc(t('sec.sess.b'))}</p></div>
  <div class="card"><h2>${esc(t('sec.cache.t'))}</h2><p>${esc(t('sec.cache.b'))}</p><div class="row" style="margin-top:0"><button class="btn sec" type="button" data-sec="cache">${esc(t('sec.cache.clear'))}</button></div></div>
  <div class="card"><h2>${esc(t('sec.gl.t'))}</h2><p>${esc(t('sec.gl.1'))}</p><p>${esc(t('sec.gl.2'))}</p><p style="margin:0">${esc(t('sec.gl.3'))}</p></div>
  <div class="card"><h2>${esc(t('sec.lim.t'))}</h2><ul style="margin:0;padding-left:20px"><li>${esc(t('sec.lim.1'))}</li><li>${esc(t('sec.lim.2'))}</li><li>${esc(t('sec.lim.3'))}</li><li>${esc(t('sec.lim.4'))}</li></ul></div>
  <div class="card"><h2>${esc(t('sec.wipe.t'))}</h2><p>${esc(t('sec.wipe.b'))}</p><div class="row" style="margin-top:0"><button class="btn danger" type="button" data-sec="wipe">${esc(t('sec.wipe.btn'))}</button></div></div>`;
}
async function clearOfflineCache() {
  let did = false;
  try {
    if ('caches' in window) for (const k of await caches.keys()) { if (/^(anonyx|anonymiseur)-/.test(k)) { await caches.delete(k); did = true; } }
    if ('serviceWorker' in navigator) for (const r of await navigator.serviceWorker.getRegistrations()) { await r.unregister(); did = true; }
  } catch (e) { /* ignore */ }
  return did;
}
$('#sec-body').addEventListener('click', async e => {
  const b = e.target.closest('[data-sec]');
  if (!b) return;
  const a = b.dataset.sec;
  if (a === 'lock') { vaultLock(); toast(t('vt.lockedMsg')); }
  else if (a === 'clearhist') { if (await confirmDialog(t('sec.clearHistConfirm'), t('sec.clearHist'), true)) { clearHistory(); renderSecurity(); } }
  else if (a === 'cache') { const d = await clearOfflineCache(); if (d) logActivity('cache'); say('#m-sec', d ? t('sec.cache.done') : t('sec.cache.na'), d ? 'ok' : 'warn'); }
  else if (a === 'wipe' && await confirmDialog(t('sec.wipe.confirm'), t('sec.wipe.btn'), true)) {
    wipeAll(); setLang(prefs.lang); refreshAll(); say('#m-sec', t('sec.wipe.done'), 'ok');
  }
});
$('#sec-body').addEventListener('change', e => {
  if (e.target.id === 'sec-lock') { setPref('lockMin', +e.target.value); if (vaultOpen()) armLock(); }
  else if (e.target.id === 'sec-hist') setPref('history', e.target.checked);
  else if (e.target.id === 'sec-names') setPref('keepNames', e.target.checked);
  else return;
  say('#m-sec', t('pf.saved'), 'ok');
});

/* ---- Profil ---- */
function renderProfile() {
  $('#pf-name').value = prefs.name || '';
  $('#pf-lang').value = LANG;
  $('#pf-labels').value = prefs.labelLang;
}
$('#pf-name').addEventListener('change', e => { setPref('name', e.target.value.trim()); say('#m-pf', t('pf.saved'), 'ok'); });
$('#pf-lang').addEventListener('change', e => applyLang(e.target.value));
$('#pf-labels').addEventListener('change', e => {
  setPref('labelLang', e.target.value);
  if (state.items.length) { computeStats(); renderItems(); }
  say('#m-pf', t('pf.saved'), 'ok');
});
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; $('#pwa-install').hidden = false; });
window.addEventListener('appinstalled', () => { deferredInstall = null; $('#pwa-install').hidden = true; });
$('#pwa-install').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
  deferredInstall = null; $('#pwa-install').hidden = true;
});

/* ---- Langue ---- */
function langButtons() { document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === LANG))); }
function refreshAll() {
  applyI18n(document);
  buildNav(); langButtons();
  renderTypeSelect();
  if (state.items.length) { computeStats(); renderItems(); }
  if (state.result) renderResult();
  refreshMapChoices();
  setStep(state.step);
  const ttl = t('nav.' + current);
  $('#topbar-title').textContent = ttl; document.title = ttl + ' — ANONYX';
  renderView(current);
}
function applyLang(l) {
  if (l !== 'fr' && l !== 'en') return;
  setPref('lang', l); setLang(l); refreshAll();
}

/* ---- Verrouillage automatique, erreurs globales ---- */
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, () => { if (vaultOpen()) armLock(); }, { passive: true }));
onVaultChange(kind => {
  if (kind === 'auto') toast(t('vt.autolocked'));
  renderView(current);
});
let lastErr = 0;
function onErr() { if (Date.now() - lastErr > 5000) { lastErr = Date.now(); toast(t('err.unexpected'), 'err'); } }
window.addEventListener('error', onErr);
window.addEventListener('unhandledrejection', onErr);

/* ---- Démarrage ---- */
applyI18n(document);
buildNav(); langButtons(); setStep(1);
route();
