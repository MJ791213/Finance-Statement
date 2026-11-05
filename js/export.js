/* Excel export (SheetJS). The workbook is generated in the browser and saved
 * straight to your Downloads folder. */
(function (root) {
  'use strict';
  const FS = root.FS;

  function sheetName(name, used) {
    let n = String(name).replace(/[\[\]:*?\/\\]/g, '-').slice(0, 31) || 'Sheet';
    let i = 2;
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + ' ' + i++;
    used.add(n.toLowerCase());
    return n;
  }

  function addSheet(wb, used, name, rows, widths) {
    const ws = root.XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
    root.XLSX.utils.book_append_sheet(wb, ws, sheetName(name, used));
  }

  const acct = (t) => `${t.bank || 'Unknown bank'} ••${t.last4 || '????'}`;

  /** @param txs the transactions currently shown (after filters) */
  function buildWorkbook(state, txs, label) {
    const XLSX = root.XLSX;
    const wb = XLSX.utils.book_new();
    const used = new Set();
    const stmtIds = new Set(txs.map((t) => t.statementId));
    const statements = state.statements.filter((s) => stmtIds.has(s.id) || !txs.length);

    // 1. Accounts
    const acctRows = [['Bank', 'Last 4', 'Account type', 'Period start', 'Period end', 'Transactions', 'Spending', 'Payments & credits', 'File']];
    for (const s of statements) {
      const st = txs.filter((t) => t.statementId === s.id);
      const sum = FS.Engine.summarize(state, st);
      acctRows.push([s.bank, s.last4, s.accountType, s.periodStart, s.periodEnd, st.length, sum.spending, sum.credits, s.fileName]);
    }
    addSheet(wb, used, 'Accounts', acctRows, [18, 8, 13, 12, 12, 12, 12, 18, 40]);

    // 2. Summary by category (+ by month)
    const summary = FS.Engine.summarize(state, txs);
    const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();
    const sumRows = [[`Spending summary${label ? ' — ' + label : ''}`], [], ['Category', 'Total', '% of spending', 'Count', ...months]];
    const rows = FS.Engine.splitRows(state, txs);
    for (const r of summary.rows.filter((x) => x.count)) {
      const byMonth = months.map((m) => FS.round2(rows.filter((x) => x.category === r.category && x.tx.date.startsWith(m)).reduce((s, x) => s + x.amount, 0)));
      sumRows.push([r.category + (r.excluded ? ' (not spending)' : ''), r.amount, r.excluded || !summary.spending ? '' : FS.round2((r.amount / summary.spending) * 100) / 100, r.count, ...byMonth]);
    }
    sumRows.push([], ['Total spending', summary.spending], ['Payments & credits received', summary.credits]);
    const ws = XLSX.utils.aoa_to_sheet(sumRows);
    ws['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 13 }, { wch: 8 }, ...months.map(() => ({ wch: 11 }))];
    for (let r = 3; r < sumRows.length; r++) {
      const c = ws[XLSX.utils.encode_cell({ r, c: 2 })];
      if (c && typeof c.v === 'number') c.z = '0.0%';
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName('Summary', used));

    // 3. All transactions
    const txRows = [['Date', 'Bank', 'Last 4', 'Description', 'Amount (+ out / - in)', 'Category', 'How categorised', 'Trip', 'Split detail']];
    for (const t of txs) {
      txRows.push([t.date, t.bank, t.last4, t.description, t.amount, t.category, t.source, t.tripName,
        t.splits.length > 1 ? t.splits.map((s) => `${s.category}: ${s.amount.toFixed(2)}`).join(' | ') : '']);
    }
    addSheet(wb, used, 'Transactions', txRows, [11, 16, 7, 45, 12, 22, 12, 22, 50]);

    // 4. One tab per category
    for (const c of state.categories) {
      const cr = rows.filter((r) => r.category === c.name);
      if (!cr.length) continue;
      const out = [['Date', 'Account', 'Description', 'Amount', 'Detail', 'Trip']];
      for (const r of cr) out.push([r.tx.date, acct(r.tx), r.tx.description, r.amount, r.label, r.tx.tripName]);
      out.push([], ['', '', 'Total', FS.round2(cr.reduce((s, r) => s + r.amount, 0))]);
      addSheet(wb, used, c.name, out, [11, 22, 45, 11, 45, 22]);
    }

    // 5. Trips
    const trips = [...(state.trips || []).map((t) => ({ ...t, source: 'manual' })), ...((state.computed && state.computed.autoTrips) || [])];
    if (trips.length) {
      const out = [['Trip', 'Start', 'End', 'Source', 'Travel spending in period']];
      for (const tr of trips) {
        const amt = rows.filter((r) => r.tx.tripId === tr.id && r.category === FS.Categories.TRAVEL).reduce((s, r) => s + r.amount, 0);
        out.push([tr.name, tr.start, tr.end, tr.source === 'auto' ? 'auto-detected' : 'manual', FS.round2(amt)]);
      }
      addSheet(wb, used, 'Trips', out, [30, 11, 11, 14, 20]);
    }

    // 6. Receipts
    if (state.receipts.length) {
      const txById = new Map(state.transactions.map((t) => [t.id, t]));
      const out = [['Merchant', 'Order #', 'Date', 'Receipt total', 'Item', 'Item amount', 'Item category', 'Matched transaction']];
      const rules = FS.Engine.allRules(state);
      for (const r of state.receipts) {
        const matched = (r.txIds || []).map((id) => txById.get(id)).filter(Boolean).map((t) => `${t.date} ${t.description} ${t.amount.toFixed(2)}`).join(' | ') || 'not matched';
        const items = r.items && r.items.length ? r.items : [{ name: '(no line items)', amount: r.total }];
        for (const it of items) out.push([r.merchant, r.orderId, r.date, r.total, it.name, it.amount, FS.Engine.itemCategory(it, rules, r.manualCategory || 'Shopping'), matched]);
      }
      addSheet(wb, used, 'Receipts', out, [12, 22, 11, 12, 50, 11, 22, 50]);
    }
    return wb;
  }

  function exportExcel(state, txs, label) {
    const wb = buildWorkbook(state, txs, label);
    const stamp = new Date().toISOString().slice(0, 10);
    const name = `statement-categories${label ? '-' + label.replace(/[^\w-]+/g, '_') : ''}-${stamp}.xlsx`;
    root.XLSX.writeFile(wb, name, { compression: true });
    return name;
  }

  FS.Export = { buildWorkbook, exportExcel, sheetName };
})(typeof window !== 'undefined' ? window : globalThis);
