/* Persists the workspace in this browser's localStorage. Nothing is sent over
 * the network. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const KEY = 'finance-statement.workspace.v1';

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

  function load() {
    try {
      const raw = root.localStorage && root.localStorage.getItem(KEY);
      return raw ? normalize(JSON.parse(raw)) : emptyState();
    } catch (e) {
      console.error('Could not read saved workspace', e);
      return emptyState();
    }
  }

  function save(state) {
    try { root.localStorage.setItem(KEY, serialize(state)); return true; } catch (e) {
      console.error('Could not save workspace', e);
      return false;
    }
  }

  function clear() { root.localStorage.removeItem(KEY); }

  FS.Store = { load, save, clear, emptyState, serialize, normalize, KEY };
})(typeof window !== 'undefined' ? window : globalThis);
