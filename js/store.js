/* Saves the workspace online, encrypted, in the signed-in user's own row.
 * Flow: open(backend, password) derives the key and decrypts the saved
 * workspace → save(state) encrypts and uploads (debounced) → lock() forgets the
 * key. Readable data only ever exists inside this browser tab. */
(function (root) {
  'use strict';
  const FS = root.FS;
  // Where older offline versions of this page kept the workspace.
  const LEGACY_KEY = 'finance-statement.workspace.v1';
  const SAVE_DELAY_MS = 800;

  function emptyState() {
    return {
      version: 1,
      statements: [],
      transactions: [],
      receipts: [],
      trips: [],
      dismissedTrips: [],
      rules: [],
      disabledBuiltins: [],
      categories: FS.Categories.DEFAULT_CATEGORIES.map((c) => ({ ...c })),
      settings: { homeStates: [], tripCategories: [FS.Categories.RESTAURANT], tripGapDays: 3, autoTrips: true },
    };
  }

  // Derived fields are rebuilt by the engine, so they are not saved.
  const DERIVED_TX = ['splits', 'category', 'baseCategory', 'source', 'rule', 'tripId', 'tripName', 'receiptIds', 'bank', 'last4'];

  function serialize(state) {
    const copy = { ...state, computed: undefined };
    copy.transactions = state.transactions.map((t) => {
      const o = { ...t };
      DERIVED_TX.forEach((k) => delete o[k]);
      return o;
    });
    copy.receipts = state.receipts.map((r) => { const o = { ...r }; delete o.txIds; return o; });
    return JSON.stringify(copy);
  }

  function normalize(obj) {
    const base = emptyState();
    const s = { ...base, ...obj, settings: { ...base.settings, ...(obj.settings || {}) } };
    if (!Array.isArray(s.categories) || !s.categories.length) s.categories = base.categories;
    return s;
  }

  // ------------------------------------------------------------ online store
  let backend = null, key = null, salt = null;
  let pending = null, timer = null, inflight = null;
  let status = 'idle';
  const listeners = [];

  function setStatus(s, detail) { status = s; listeners.forEach((fn) => fn(s, detail)); }

  /* Unlocks the user's workspace. Throws 'WRONG_PASSWORD' if it can't be decrypted. */
  async function open(be, password) {
    backend = be;
    const row = await backend.loadWorkspace();
    if (row) {
      const k = await FS.Crypto.deriveKey(password, row.salt);
      let text;
      try { text = await FS.Crypto.decrypt(k, row); } catch (e) { const err = new Error('WRONG_PASSWORD'); err.code = 'WRONG_PASSWORD'; throw err; }
      key = k; salt = row.salt;
      setStatus('saved', row.updated_at);
      return { state: normalize(JSON.parse(text)), isNew: false };
    }
    salt = FS.Crypto.newSalt();
    key = await FS.Crypto.deriveKey(password, salt);
    setStatus('idle');
    return { state: emptyState(), isNew: true };
  }

  async function upload(state) {
    if (!key) throw new Error('Workspace is locked');
    const blob = await FS.Crypto.encrypt(key, salt, serialize(state));
    await backend.saveWorkspace(blob);
  }

  async function runSave() {
    timer = null;
    if (inflight) return inflight.then(runSave); // one upload at a time; the newest state wins
    if (!pending) return;
    const state = pending; pending = null;
    setStatus('saving');
    inflight = upload(state).then(() => { if (!pending) setStatus('saved', new Date().toISOString()); },
      (e) => { console.error('Could not save workspace', e); if (!pending) pending = state; setStatus('error', e.message); })
      .finally(() => { inflight = null; });
    return inflight;
  }

  /* Queues a save; returns immediately. */
  function save(state) {
    pending = state;
    setStatus('pending');
    clearTimeout(timer);
    timer = setTimeout(runSave, SAVE_DELAY_MS);
  }

  /* Saves anything queued right now. Resolves when the upload is done. */
  async function flush() {
    clearTimeout(timer);
    await runSave();
    if (inflight) await inflight;
    if (status === 'error') throw new Error('Save failed');
  }

  /* Deletes the online workspace (the account itself stays). */
  async function clear() {
    clearTimeout(timer); pending = null;
    if (inflight) await inflight.catch(() => {});
    await backend.deleteWorkspace();
    // The key and salt stay, so the next save creates a fresh row for the same password.
    setStatus('idle');
  }

  /* Re-encrypts the workspace for a new password (call before changing the login password). */
  async function rekey(newPassword, state) {
    clearTimeout(timer); pending = null;
    if (inflight) await inflight.catch(() => {});
    const newSalt = FS.Crypto.newSalt();
    const newKey = await FS.Crypto.deriveKey(newPassword, newSalt);
    const blob = await FS.Crypto.encrypt(newKey, newSalt, serialize(state));
    await backend.saveWorkspace(blob);
    const old = { key, salt };
    key = newKey; salt = newSalt;
    setStatus('saved', new Date().toISOString());
    return old;
  }
  function restoreKey(old) { key = old.key; salt = old.salt; }

  /* Forgets the key and anything queued (used on log out). */
  function lock() { clearTimeout(timer); pending = null; key = null; salt = null; backend = null; setStatus('idle'); }

  const hasUnsaved = () => !!(pending || inflight);

  // ---------------------------------------------- data from the offline version
  function readLegacy() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(LEGACY_KEY);
      if (!raw) return null;
      const s = normalize(JSON.parse(raw));
      return s.statements.length || s.receipts.length || s.rules.length ? s : null;
    } catch (e) { return null; }
  }
  function removeLegacy() { try { root.localStorage.removeItem(LEGACY_KEY); } catch (e) { /* ignore */ } }

  FS.Store = {
    emptyState, serialize, normalize, open, save, flush, clear, rekey, restoreKey, lock, hasUnsaved, readLegacy, removeLegacy,
    onStatus: (fn) => listeners.push(fn),
    get status() { return status; },
    LEGACY_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
