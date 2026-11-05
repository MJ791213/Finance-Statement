/* Categorisation engine. Recomputes every transaction's category from scratch
 * each time something changes, in this order of priority:
 *   1. category you picked by hand
 *   2. receipt line items (split across categories when items differ)
 *   3. your own keyword rules, then the built-in keyword rules
 *   4. the category column of a bank CSV export
 *   5. "Other"
 * Then, during a trip, restaurant spending (configurable) becomes Travel. */
(function (root) {
  'use strict';
  const FS = root.FS;

  function allRules(state) {
    const disabled = new Set(state.disabledBuiltins || []);
    const builtin = FS.Categories.defaultRules().filter((r) => !disabled.has(r.kind + ':' + r.pattern));
    return [...(state.rules || []), ...builtin];
  }

  function categoryNames(state) { return state.categories.map((c) => c.name); }

  function itemCategory(item, rules, fallback) {
    if (item.manualCategory) return item.manualCategory;
    const r = FS.Categories.matchRule(item.name, rules, 'item');
    if (r) return r.category;
    // Item names like "Starbucks gift card" can still match merchant rules.
    const m = FS.Categories.matchRule(item.name, rules, 'merchant');
    if (m && !m.builtin) return m.category;
    return fallback;
  }

  function merchantCategory(tx, rules, known) {
    const r = FS.Categories.matchRule(tx.description, rules, 'merchant');
    if (r && known.has(r.category)) return { category: r.category, source: r.builtin ? 'rule' : 'my rule', rule: r.pattern };
    const hint = FS.Categories.bankCategoryHint(tx.bankCategory);
    if (hint && known.has(hint)) return { category: hint, source: 'bank' };
    return null;
  }

  /** Build splits for a transaction from the receipt(s) linked to it. */
  function receiptSplits(tx, receipts, rules, fallback) {
    const items = [];
    for (const r of receipts) for (const it of r.items || []) items.push({ ...it, receiptId: r.id });
    if (!items.length) return [{ category: receipts[0].manualCategory || fallback, amount: tx.amount, label: receipts[0].merchant + ' receipt' }];
    const byCat = new Map();
    let sum = 0;
    for (const it of items) {
      const cat = itemCategory(it, rules, receipts[0].manualCategory || fallback);
      const amt = Math.abs(it.amount || 0);
      sum += amt;
      if (!byCat.has(cat)) byCat.set(cat, { amount: 0, names: [] });
      const e = byCat.get(cat); e.amount += amt; e.names.push(it.name);
    }
    // Scale item prices to the charged amount (covers tax and shipping).
    const splits = [];
    let allocated = 0;
    const entries = [...byCat.entries()];
    entries.forEach(([cat, e], i) => {
      const amount = i === entries.length - 1 ? FS.round2(tx.amount - allocated) : FS.round2(sum ? (tx.amount * e.amount) / sum : tx.amount / entries.length);
      allocated = FS.round2(allocated + amount);
      splits.push({ category: cat, amount, label: e.names.slice(0, 3).join('; ') + (e.names.length > 3 ? ` (+${e.names.length - 3} more)` : '') });
    });
    return splits;
  }

  function recompute(state) {
    const rules = allRules(state);
    const known = new Set(categoryNames(state));
    const statements = new Map(state.statements.map((s) => [s.id, s]));
    const OTHER = 'Other';
    const fallbackShopping = known.has('Shopping') ? 'Shopping' : OTHER;

    for (const t of state.transactions) {
      const s = statements.get(t.statementId) || {};
      t.bank = s.bank || '';
      t.last4 = s.last4 || '';
    }

    // Receipts → transactions
    FS.Receipts.matchReceipts(state.receipts, state.transactions);
    const receiptsByTx = new Map();
    for (const r of state.receipts) for (const id of r.txIds || []) {
      if (!receiptsByTx.has(id)) receiptsByTx.set(id, []);
      receiptsByTx.get(id).push(r);
    }

    // Base categories (before the trip rule)
    for (const t of state.transactions) {
      const mc = merchantCategory(t, rules, known);
      t.receiptIds = (receiptsByTx.get(t.id) || []).map((r) => r.id);
      if (t.manualCategory && known.has(t.manualCategory)) {
        t.splits = [{ category: t.manualCategory, amount: t.amount }];
        t.source = 'manual';
      } else if (receiptsByTx.has(t.id) && t.amount > 0) {
        // Unmatched Amazon items default to Shopping; other receipts default to the merchant's category.
        const fallback = !mc || FS.Receipts.isAmazonReceipt(receiptsByTx.get(t.id)[0]) ? fallbackShopping : mc.category;
        t.splits = receiptSplits(t, receiptsByTx.get(t.id), rules, fallback);
        t.source = 'receipt';
      } else if (mc) {
        t.splits = [{ category: mc.category, amount: t.amount }];
        t.source = mc.source;
        t.rule = mc.rule;
      } else {
        t.splits = [{ category: t.amount < 0 && known.has('Income') && /DEPOSIT|PAYROLL/i.test(t.description) ? 'Income' : OTHER, amount: t.amount }];
        t.source = 'default';
      }
      t.baseCategory = t.splits.length === 1 ? t.splits[0].category : 'Split';
    }

    // Trips
    const settings = state.settings;
    const manualTrips = state.trips || [];
    let autoTrips = [];
    let homeStates = settings.homeStates || [];
    if (settings.autoTrips !== false) {
      const res = FS.Trips.detectTrips(state.transactions, settings);
      homeStates = res.homeStates;
      const dismissed = new Set(state.dismissedTrips || []);
      autoTrips = res.trips.filter((a) => !dismissed.has(a.key) && !manualTrips.some((m) => m.start <= a.end && m.end >= a.start));
    }
    state.computed = { autoTrips, homeStates };
    const trips = [...manualTrips.map((m) => ({ ...m, source: 'manual' })), ...autoTrips];
    const tripCats = new Set(settings.tripCategories || [FS.Categories.RESTAURANT]);
    const travel = FS.Categories.TRAVEL;

    for (const t of state.transactions) {
      const trip = FS.Trips.tripFor(t.date, trips);
      t.tripId = trip ? trip.id : null;
      t.tripName = trip ? trip.name : '';
      if (trip && t.source !== 'manual' && known.has(travel)) {
        let changed = false;
        t.splits = t.splits.map((sp) => {
          if (!tripCats.has(sp.category)) return sp;
          changed = true;
          return { ...sp, category: travel, label: (sp.label ? sp.label + ' · ' : '') + 'during ' + trip.name, fromCategory: sp.category };
        });
        if (changed) t.source = 'trip';
      }
      t.category = t.splits.length === 1 ? t.splits[0].category : 'Split';
    }
    return state;
  }

  function isExcluded(state, category) {
    const c = state.categories.find((x) => x.name === category);
    return !!(c && c.excluded);
  }

  /** Flatten transactions into category rows (one per split). */
  function splitRows(state, txs) {
    const rows = [];
    for (const t of txs) for (const sp of t.splits || []) rows.push({ tx: t, category: sp.category, amount: sp.amount, label: sp.label || '' });
    return rows;
  }

  function summarize(state, txs) {
    const totals = new Map(state.categories.map((c) => [c.name, { category: c.name, amount: 0, count: 0, excluded: !!c.excluded }]));
    let spending = 0, credits = 0;
    for (const r of splitRows(state, txs)) {
      if (!totals.has(r.category)) totals.set(r.category, { category: r.category, amount: 0, count: 0 });
      const e = totals.get(r.category);
      e.amount = FS.round2(e.amount + r.amount);
      e.count++;
      if (!e.excluded) spending = FS.round2(spending + r.amount);
    }
    for (const t of txs) if (t.amount < 0) credits = FS.round2(credits - t.amount);
    return { rows: [...totals.values()], spending, credits };
  }

  FS.Engine = { recompute, allRules, summarize, splitRows, isExcluded, itemCategory };
})(typeof window !== 'undefined' ? window : globalThis);
