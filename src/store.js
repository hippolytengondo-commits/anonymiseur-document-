/* ===== Stockage local : préférences, historique, journal, coffre chiffré =====
   Rien ne quitte l'appareil. Le contenu des documents n'est jamais conservé.
   Les tables de correspondance ne sont conservées que chiffrées (AES-256-GCM,
   clé dérivée de la phrase secrète par PBKDF2) ; la clé reste en mémoire. */
const KEYS = { prefs: 'anonyx_prefs_v1', hist: 'anonyx_history_v1', act: 'anonyx_activity_v1', vault: 'anonyx_vault_v1', legacy: 'anonymiseur_tables_v1' };
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

/* ---- Préférences ---- */
const PREF_DEFAULTS = { lang: '', name: '', history: true, keepNames: false, lockMin: 10, labelLang: 'auto' };
let prefs = Object.assign({}, PREF_DEFAULTS, lsGet(KEYS.prefs, {}));
if (prefs.lang !== 'fr' && prefs.lang !== 'en') prefs.lang = String(navigator.language || 'fr').toLowerCase().startsWith('en') ? 'en' : 'fr';
function setPref(k, v) { prefs[k] = v; lsSet(KEYS.prefs, prefs); }
function labLang() {
  const p = prefs.labelLang;
  if (LANGS.includes(p)) return p;
  if (p === 'doc') { const d = (typeof state !== 'undefined' && state.langs || [])[0]; return LANGS.includes(d) ? d : LANG; }
  return LANG;
}

/* ---- Historique des documents (métadonnées uniquement) ---- */
function histAll() { const l = lsGet(KEYS.hist, []); return Array.isArray(l) ? l : []; }
function histUpsert(e) {
  if (!prefs.history) return;
  const l = histAll(), i = l.findIndex(x => x.id === e.id);
  if (i >= 0) l[i] = Object.assign(l[i], e); else l.unshift(e);
  lsSet(KEYS.hist, l.slice(0, 200));
}
function histDelete(id) { lsSet(KEYS.hist, histAll().filter(x => x.id !== id)); }

/* ---- Journal des activités (aucun contenu de document) ---- */
function actAll() { const l = lsGet(KEYS.act, []); return Array.isArray(l) ? l : []; }
function logActivity(type, data) {
  if (!prefs.history) return;
  const l = actAll();
  l.unshift({ ts: Date.now(), type, data: data || {} });
  lsSet(KEYS.act, l.slice(0, 300));
}
function clearHistory() { lsDel(KEYS.hist); lsDel(KEYS.act); }

/* ---- Coffre chiffré ---- */
const VAULT_ITER = 600000;
const _enc = new TextEncoder(), _dec = new TextDecoder();
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));
let vKey = null, vTimer = null;
const vaultHooks = [];
function onVaultChange(fn) { vaultHooks.push(fn); }
function fireVault(kind) { for (const f of vaultHooks) { try { f(kind); } catch (e) { /* ignore */ } } }

function cryptoOk() { return !!(window.crypto && crypto.subtle && crypto.getRandomValues); }
function vaultData() { const v = lsGet(KEYS.vault, null); return v && Array.isArray(v.items) ? v : null; }
function vaultExists() { return !!vaultData(); }
function vaultOpen() { return !!vKey; }
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', _enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function aesEnc(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, _enc.encode(JSON.stringify(obj))));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function aesDec(key, rec) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(rec.iv) }, key, fromB64(rec.ct));
  return JSON.parse(_dec.decode(pt));
}
function armLock() {
  clearTimeout(vTimer);
  if (!vKey) return;
  vTimer = setTimeout(() => { if (vKey) vaultLock(true); }, Math.max(1, +prefs.lockMin || 10) * 60000);
}
function legacyTables() { const l = lsGet(KEYS.legacy, []); return Array.isArray(l) ? l.filter(m => m && Array.isArray(m.entries)) : []; }
async function migrateLegacy() {
  const old = legacyTables();
  if (!vKey || !old.length) return 0;
  let n = 0;
  for (const m of old) { if (!m.id) m.id = 'm' + Date.now().toString(36) + n; if (await vaultAdd(m, true)) n++; }
  if (n === old.length) lsDel(KEYS.legacy);
  if (n) logActivity('migrate', { n });
  return n;
}
async function vaultCreate(pass) {
  if (!cryptoOk()) throw new Error('crypto');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt, VAULT_ITER);
  const v = { v: 1, iter: VAULT_ITER, salt: toB64(salt), check: await aesEnc(key, 'anonyx'), items: [] };
  if (!lsSet(KEYS.vault, v)) throw new Error('storage');
  vKey = key; armLock(); logActivity('vaultCreate');
  const migrated = await migrateLegacy();
  fireVault('create');
  return migrated;
}
async function vaultUnlock(pass) {
  const v = vaultData();
  if (!v) throw new Error('novault');
  if (!cryptoOk()) throw new Error('crypto');
  const key = await deriveKey(pass, fromB64(v.salt), v.iter);
  try { await aesDec(key, v.check); } catch (e) { return false; }
  vKey = key; armLock(); logActivity('vaultUnlock');
  const migrated = await migrateLegacy();
  fireVault('unlock');
  return migrated || true;
}
function vaultLock(auto) {
  if (!vKey) return;
  vKey = null; clearTimeout(vTimer);
  logActivity(auto ? 'vaultAuto' : 'vaultLock');
  fireVault(auto ? 'auto' : 'lock');
}
function vaultList() { const v = vaultData(); return v ? v.items.map(i => ({ id: i.id, created: i.created, count: i.count, label: i.label || '' })) : []; }
async function vaultAdd(mapping, silent) {
  if (!vKey) throw new Error('locked');
  const v = vaultData();
  if (!v) throw new Error('novault');
  const rec = await aesEnc(vKey, mapping);
  const item = Object.assign({ id: mapping.id, created: mapping.created || new Date().toISOString(), count: (mapping.entries || []).length, label: prefs.keepNames ? String(mapping.document || '') : '' }, rec);
  v.items = [item].concat(v.items.filter(i => i.id !== item.id)).slice(0, 100);
  if (!lsSet(KEYS.vault, v)) throw new Error('storage');
  if (!silent) logActivity('vaultSave');
  fireVault('change');
  return true;
}
async function vaultGet(id) {
  if (!vKey) throw new Error('locked');
  const v = vaultData(), i = v && v.items.find(x => x.id === id);
  if (!i) return null;
  return aesDec(vKey, i);
}
function vaultDelete(id) {
  const v = vaultData();
  if (!v) return;
  v.items = v.items.filter(i => i.id !== id);
  lsSet(KEYS.vault, v); logActivity('vaultDel'); fireVault('change');
}
async function vaultChangePass(oldPass, newPass) {
  const v = vaultData();
  if (!v) throw new Error('novault');
  const oldKey = await deriveKey(oldPass, fromB64(v.salt), v.iter);
  try { await aesDec(oldKey, v.check); } catch (e) { return false; }
  const maps = [];
  for (const i of v.items) maps.push({ meta: i, data: await aesDec(oldKey, i) });
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(newPass, salt, VAULT_ITER);
  const nv = { v: 1, iter: VAULT_ITER, salt: toB64(salt), check: await aesEnc(key, 'anonyx'), items: [] };
  for (const m of maps) nv.items.push(Object.assign({ id: m.meta.id, created: m.meta.created, count: m.meta.count, label: m.meta.label || '' }, await aesEnc(key, m.data)));
  if (!lsSet(KEYS.vault, nv)) throw new Error('storage');
  vKey = key; armLock(); logActivity('vaultPass'); fireVault('change');
  return true;
}
function wipeAll() {
  vKey = null; clearTimeout(vTimer);
  for (const k of Object.values(KEYS)) lsDel(k);
  prefs = Object.assign({}, PREF_DEFAULTS, { lang: prefs.lang });
  fireVault('wipe');
}

/* ---- Export CSV : neutralisation des formules (Excel / Sheets) ---- */
function csvCell(s) {
  s = String(s);
  const risky = /^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && /[^\d\s().+\-]/.test(s));
  if (risky) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
if (typeof module !== 'undefined') module.exports = { csvCell };
