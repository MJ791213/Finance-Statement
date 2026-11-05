/* UI controller: tabs, filters, rendering and user actions. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = FS.escapeHtml;
  const money = FS.fmtMoney;

  let state = FS.Store.load();
  const ui = { tab: 'import', account: '', month: '', catTab: null, search: '', txCat: '', importLog: [] };

  // ----------------------------------------------------------- state helpers
  function commit(msg) {
    FS.Engine.recompute(state);
    if (!FS.Store.save(state)) toast('Warning: could not save to browser storage (storage full?). Use Backup.');
    render();
    if (msg) toast(msg);
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  const accountLabel = (s) => `${s.bank || 'Unknown bank'} ••${s.last4 || '????'}`;
  const accountKey = (s) => `${s.bank}|${s.last4}`;

  function filteredTx() {
    const stmts = new Map(state.statements.map((s) => [s.id, s]));
    return state.transactions
      .filter((t) => !ui.account || accountKey(stmts.get(t.statementId) || {}) === ui.account)
      .filter((t) => !ui.month || t.date.startsWith(ui.month))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function filterLabel() {
    const parts = [];
    if (ui.account) { const s = state.statements.find((x) => accountKey(x) === ui.account); if (s) parts.push(`${s.bank}-${s.last4}`); }
    if (ui.month) parts.push(ui.month);
    return parts.join('_');
  }

  function categoryColor(name) {
    const c = state.categories.find((x) => x.name === name);
    return c ? c.color : '#999';
  }

  function categoryOptions(selected, { auto = false, includeSplit = false } = {}) {
    let html = auto ? `<option value="">(auto)</option>` : '';
    if (includeSplit) html += `<option value="__split" selected disabled>Split</option>`;
    for (const c of state.categories) html += `<option ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`;
    return html;
  }

  const SOURCE_LABEL = { manual: 'you set', receipt: 'receipt', trip: 'trip', 'my rule': 'my rule', rule: 'keyword', bank: 'bank category', default: 'uncategorized' };
  function sourceBadge(t) {
    const cls = { manual: 'manual', receipt: 'receipt', trip: 'trip', 'my rule': 'myrule', default: 'default' }[t.source] || '';
    const title = t.source === 'rule' || t.source === 'my rule' ? `matched keyword "${t.rule}"` : '';
    return `<span class="badge ${cls}" title="${esc(title)}">${SOURCE_LABEL[t.source] || t.source}</span>`;
  }

  // ------------------------------------------------------------------ import
  async function readFile(file) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return { kind: 'pdf', lines: await FS.pdfToLines(await file.arrayBuffer()) };
    const text = await file.text();
    if (/\.csv$/i.test(file.name) || /^[^\n]*,[^\n]*,/.test(text)) return { kind: 'csv', text };
    return { kind: 'text', lines: text.split(/\r?\n/) };
  }

  async function importStatements(files) {
    for (const file of files) {
      try {
        const data = await readFile(file);
        let st;
        if (data.kind === 'csv') st = FS.Statement.parseStatementCSV(data.text, file.name);
        else st = FS.Statement.parseStatementText(data.lines, file.name);
        if (!st.transactions.length) {
          logImport('err', `${file.name}: no transactions found. If this is a scanned (image) PDF, download the CSV version from your bank instead.`);
          continue;
        }
        const key = FS.hash(JSON.stringify(st.transactions.map((t) => [t.date, t.description, t.amount])));
        const existing = state.statements.find((s) => s.contentKey === key);
        if (existing) { logImport('err', `${file.name}: already imported (same transactions as ${existing.fileName}). Skipped.`); continue; }
        const id = FS.uid('st');
        const { transactions, ...meta } = st;
        state.statements.push({ ...meta, id, contentKey: key, importedAt: new Date().toISOString() });
        for (const t of transactions) state.transactions.push({ id: FS.uid('tx'), statementId: id, ...t });
        logImport('ok', `${file.name}: ${transactions.length} transactions · ${st.bank || 'bank not detected'} ••${st.last4 || '????'} · ${st.periodStart || '?'} → ${st.periodEnd || '?'}${!st.bank || !st.last4 ? ' — fill in the missing bank/last 4 on the Accounts tab' : ''}`);
      } catch (e) {
        console.error(e);
        logImport('err', `${file.name}: ${e.message}`);
      }
    }
    commit();
  }

  async function importReceipts(files) {
    for (const file of files) {
      try {
        const data = await readFile(file);
        let list;
        if (data.kind === 'csv') list = FS.Receipts.parseAmazonCSV(data.text, file.name);
        else list = [FS.Receipts.parseReceiptText(data.lines, file.name)];
        let added = 0;
        for (const r of list) {
          const key = FS.hash([r.merchant, r.orderId, r.shipDate, r.date, r.total].join('|'));
          if (state.receipts.some((x) => x.key === key)) continue;
          state.receipts.push({ ...r, id: FS.uid('rc'), key });
          added++;
        }
        logImport('ok', `${file.name}: ${added} receipt(s) added${list.length - added ? `, ${list.length - added} duplicate(s) skipped` : ''}`);
      } catch (e) {
        console.error(e);
        logImport('err', `${file.name}: ${e.message}`);
      }
    }
    commit();
    const unmatched = state.receipts.filter((r) => !(r.txIds || []).length).length;
    logImport(unmatched ? 'err' : 'ok', `${state.receipts.length - unmatched} of ${state.receipts.length} receipts matched to a transaction${unmatched ? ' — link the rest on the Receipts tab' : ''}`);
    render();
  }

  function logImport(kind, msg) { ui.importLog.unshift({ kind, msg }); ui.importLog = ui.importLog.slice(0, 40); }

  function dropZone(id, title, hint, accept) {
    return `<div class="drop" data-drop="${id}"><strong>${title}</strong><span class="muted">${hint}</span><br><br>
      <label class="button">Choose files<input type="file" data-input="${id}" multiple accept="${accept}" hidden></label></div>`;
  }

  function renderImport() {
    return `
    <div class="grid2">
      <div class="panel"><h2>1 · Bank statements</h2>
        ${dropZone('statements', 'Drop statement PDFs or CSV exports here', 'Any bank. Text PDFs and CSV downloads both work. Upload several months or accounts at once.', '.pdf,.csv,.txt')}
      </div>
      <div class="panel"><h2>2 · Receipts (optional)</h2>
        ${dropZone('receipts', 'Drop receipts here', 'Amazon order history CSV, Amazon order/invoice PDFs, or other receipt PDFs. Items are used to split and re-categorize the matching charge.', '.pdf,.csv,.txt')}
        <details class="small" style="margin-top:8px"><summary>How do I get my Amazon order history?</summary>
          <p>Amazon → Account → <em>Request Your Data</em> → "Your Orders". The download contains <code>Retail.OrderHistory.1.csv</code>; drop that file here.
          Or open an order → <em>View invoice</em> → print to PDF, and drop the PDF.</p></details>
      </div>
    </div>
    <div class="panel"><h2>Import log</h2>
      ${ui.importLog.length ? `<ul class="log">${ui.importLog.map((l) => `<li class="${l.kind}">${l.kind === 'err' ? '⚠' : '✓'} ${esc(l.msg)}</li>`).join('')}</ul>` : '<p class="muted">Nothing imported in this session yet.</p>'}
      <p class="muted small">Workspace: ${state.statements.length} statement(s), ${state.transactions.length} transactions, ${state.receipts.length} receipt(s). Saved only in this browser on this computer.</p>
    </div>`;
  }

  // ---------------------------------------------------------------- accounts
  function renderAccounts() {
    if (!state.statements.length) return empty('No statements yet — import one on the Import tab.');
    const rows = state.statements.slice().sort((a, b) => ((a.periodEnd || '') < (b.periodEnd || '') ? 1 : -1)).map((s) => {
      const txs = state.transactions.filter((t) => t.statementId === s.id);
      const sum = FS.Engine.summarize(state, txs);
      return `<tr data-stmt="${s.id}">
        <td><input data-field="bank" value="${esc(s.bank)}" placeholder="Bank name" size="16"></td>
        <td><input data-field="last4" value="${esc(s.last4)}" placeholder="1234" size="5" maxlength="4"></td>
        <td><select data-field="accountType">${['', 'Credit Card', 'Checking', 'Savings'].map((x) => `<option ${x === s.accountType ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td>${esc(s.periodStart || '?')} → ${esc(s.periodEnd || '?')}</td>
        <td class="num">${txs.length}</td>
        <td class="num">${money(sum.spending)}</td>
        <td class="num">${money(sum.credits)}</td>
        <td class="small muted">${esc(s.fileName)}</td>
        <td><button class="mini" data-act="flip-stmt" title="Use if purchases show up as credits">Flip ±</button>
            <button class="mini danger" data-act="del-stmt">Delete</button></td></tr>`;
    }).join('');
    return `<div class="panel"><h2>Accounts &amp; statements</h2>
      <p class="muted small">Bank name and last 4 digits are detected automatically — correct them here if needed. "Flip ±" swaps money-in and money-out for a statement whose signs were read the wrong way round.</p>
      <div class="table-wrap"><table><thead><tr><th>Bank</th><th>Last 4</th><th>Type</th><th>Period</th><th class="num">Txns</th><th class="num">Spending</th><th class="num">Payments &amp; credits</th><th>File</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
  }

  // ----------------------------------------------------------------- summary
  function renderSummary() {
    const txs = filteredTx();
    if (!txs.length) return empty('No transactions for this selection.');
    const sum = FS.Engine.summarize(state, txs);
    const spendRows = sum.rows.filter((r) => r.count && !r.excluded).sort((a, b) => b.amount - a.amount);
    const exRows = sum.rows.filter((r) => r.count && r.excluded);
    const max = Math.max(...spendRows.map((r) => r.amount), 1);
    const uncategorized = txs.filter((t) => t.category === 'Other').length;
    const months = [...new Set(txs.map((t) => t.date.slice(0, 7)))].sort();
    const accounts = [...new Set(txs.map((t) => `${t.bank || '?'} ••${t.last4 || '????'}`))];

    const catRow = (r) => `<tr class="${r.excluded ? 'excluded' : ''}" data-goto-cat="${esc(r.category)}" style="cursor:pointer">
      <td><span class="swatch" style="background:${categoryColor(r.category)}"></span>${esc(r.category)}</td>
      <td class="num">${money(r.amount)}</td>
      <td class="num">${r.excluded || !sum.spending ? '' : ((r.amount / sum.spending) * 100).toFixed(1) + '%'}</td>
      <td class="num">${r.count}</td>
      <td class="bar-cell">${r.excluded ? '' : `<div class="bar" style="width:${Math.max(0, (r.amount / max) * 100)}%;background:${categoryColor(r.category)}"></div>`}</td></tr>`;

    let monthTable = '';
    if (months.length > 1) {
      const rows = FS.Engine.splitRows(state, txs);
      monthTable = `<div class="panel"><h2>By month</h2><div class="table-wrap"><table><thead><tr><th>Category</th>${months.map((m) => `<th class="num">${m}</th>`).join('')}</tr></thead><tbody>
        ${spendRows.map((r) => `<tr><td>${esc(r.category)}</td>${months.map((m) => `<td class="num">${money(rows.filter((x) => x.category === r.category && x.tx.date.startsWith(m)).reduce((s, x) => s + x.amount, 0))}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
    }

    return `<div class="tiles">
        <div class="tile"><div class="label">Total spending</div><div class="value">${money(sum.spending)}</div></div>
        <div class="tile"><div class="label">Payments &amp; credits in</div><div class="value">${money(sum.credits)}</div></div>
        <div class="tile"><div class="label">Transactions</div><div class="value">${txs.length}</div></div>
        <div class="tile"><div class="label">Uncategorized ("Other")</div><div class="value">${uncategorized}</div></div>
      </div>
      <div class="panel"><h2>Spending by category</h2>
        <p class="muted small">Accounts: ${esc(accounts.join(', '))}. Click a row to see its transactions.</p>
        <table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th><th class="num">Count</th><th></th></tr></thead>
        <tbody>${spendRows.map(catRow).join('')}${exRows.length ? `<tr><td colspan="5" class="muted small">Not counted as spending:</td></tr>${exRows.map(catRow).join('')}` : ''}</tbody></table>
      </div>${monthTable}`;
  }

  // -------------------------------------------------------------- categories
  function renderCategories() {
    const txs = filteredTx();
    const rows = FS.Engine.splitRows(state, txs);
    const counts = new Map();
    rows.forEach((r) => { const e = counts.get(r.category) || { n: 0, amt: 0 }; e.n++; e.amt += r.amount; counts.set(r.category, e); });
    const cats = state.categories.filter((c) => counts.has(c.name));
    if (!cats.length) return empty('No transactions for this selection.');
    if (!ui.catTab || !counts.has(ui.catTab)) ui.catTab = cats[0].name;
    const list = rows.filter((r) => r.category === ui.catTab);
    const total = list.reduce((s, r) => s + r.amount, 0);
    return `<div class="chips">${cats.map((c) => `<button class="chip ${c.name === ui.catTab ? 'active' : ''}" data-cat-tab="${esc(c.name)}"><span class="swatch" style="background:${c.color}"></span>${esc(c.name)} · ${money(counts.get(c.name).amt)}</button>`).join('')}</div>
      <div class="panel"><h2><span class="swatch" style="background:${categoryColor(ui.catTab)}"></span>${esc(ui.catTab)} — ${money(total)} (${list.length})</h2>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th class="num">Amount</th><th>Why</th><th>Trip</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td>${r.tx.date}</td><td class="small">${esc(r.tx.bank)} ••${esc(r.tx.last4)}</td>
        <td class="desc">${esc(r.tx.description)}${r.label ? `<div class="splits">${esc(r.label)}</div>` : ''}</td>
        <td class="num ${r.amount < 0 ? 'neg' : ''}">${money(r.amount)}</td><td>${sourceBadge(r.tx)}</td><td class="small">${esc(r.tx.tripName)}</td></tr>`).join('')}
      </tbody></table></div></div>`;
  }

  // ------------------------------------------------------------ transactions
  function renderTransactions() {
    let txs = filteredTx();
    if (!txs.length) return empty('No transactions for this selection.');
    const q = ui.search.trim().toLowerCase();
    if (q) txs = txs.filter((t) => t.description.toLowerCase().includes(q) || String(t.amount).includes(q));
    if (ui.txCat === '__other') txs = txs.filter((t) => t.category === 'Other');
    else if (ui.txCat) txs = txs.filter((t) => t.splits.some((s) => s.category === ui.txCat));
    const rows = txs.map((t) => `<tr data-tx="${t.id}">
      <td>${t.date}</td><td class="small">${esc(t.bank)} ••${esc(t.last4)}</td>
      <td class="desc">${esc(t.description)}${t.splits.length > 1 ? `<div class="splits">${t.splits.map((s) => `${esc(s.category)} ${money(s.amount)}`).join(' · ')}</div>` : ''}</td>
      <td class="num ${t.amount < 0 ? 'neg' : ''}">${money(t.amount)}</td>
      <td><select data-act="set-cat">${t.manualCategory ? categoryOptions(t.manualCategory, { auto: true }) : (t.splits.length > 1 ? categoryOptions(null, { auto: true, includeSplit: true }).replace('<option value="">(auto)</option>', '<option value="">(auto: split)</option>') : categoryOptions(t.category, { auto: true }))}</select></td>
      <td>${sourceBadge(t)}${t.receiptIds && t.receiptIds.length ? ' <span title="matched to a receipt">🧾</span>' : ''}</td>
      <td class="small">${esc(t.tripName)}</td>
      <td><button class="mini" data-act="make-rule" title="Always put this merchant in the chosen category">Always…</button></td></tr>`).join('');
    return `<div class="panel">
      <div class="row"><input id="tx-search" placeholder="Search description or amount" value="${esc(ui.search)}" size="30">
        <select id="tx-cat"><option value="">All categories</option><option value="__other" ${ui.txCat === '__other' ? 'selected' : ''}>Only uncategorized (Other)</option>${state.categories.map((c) => `<option ${c.name === ui.txCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <span class="muted small">${txs.length} shown. Positive = money out, <span class="neg">negative = money in</span>. Change a category to override it; "Always…" turns it into a rule for every statement.</span></div>
      <div class="table-wrap"><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th class="num">Amount</th><th>Category</th><th>Why</th><th>Trip</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  // ------------------------------------------------------------------- trips
  function tripStats(trip) {
    const txs = state.transactions.filter((t) => t.tripId === trip.id);
    const travel = txs.reduce((s, t) => s + t.splits.filter((x) => x.category === FS.Categories.TRAVEL).reduce((a, x) => a + x.amount, 0), 0);
    const meals = txs.reduce((s, t) => s + t.splits.filter((x) => x.fromCategory).reduce((a, x) => a + x.amount, 0), 0);
    return { n: txs.length, travel, meals };
  }

  function renderTrips() {
    const auto = (state.computed && state.computed.autoTrips) || [];
    const home = (state.computed && state.computed.homeStates) || [];
    const manual = state.trips;
    const tripCats = (state.settings.tripCategories || []).join(', ') || 'nothing';
    const manualRows = manual.map((t) => { const st = tripStats(t); return `<tr data-trip="${t.id}">
      <td><input data-field="name" value="${esc(t.name)}" size="24"></td><td><input type="date" data-field="start" value="${t.start}"></td><td><input type="date" data-field="end" value="${t.end}"></td>
      <td class="num">${st.n}</td><td class="num">${money(st.meals)}</td><td class="num">${money(st.travel)}</td><td><button class="mini danger" data-act="del-trip">Delete</button></td></tr>`; }).join('');
    const autoRows = auto.map((t) => { const st = tripStats(t); return `<tr data-auto-trip="${esc(t.key)}">
      <td>${esc(t.name)}<div class="splits">${esc(t.reason)}</div></td><td>${t.start}</td><td>${t.end}</td>
      <td class="num">${st.n}</td><td class="num">${money(st.meals)}</td><td class="num">${money(st.travel)}</td>
      <td><button class="mini" data-act="keep-trip" title="Keep it and edit its dates">Keep &amp; edit</button> <button class="mini danger" data-act="dismiss-trip">Not a trip</button></td></tr>`; }).join('');
    const head = `<thead><tr><th>Trip</th><th>Start</th><th>End</th><th class="num">Txns</th><th class="num">Re-categorized to Travel</th><th class="num">Travel total</th><th></th></tr></thead>`;
    return `<div class="panel"><h2>Trips</h2>
      <p class="muted small">During a trip, <strong>${esc(tripCats)}</strong> spending is moved to <strong>${esc(FS.Categories.TRAVEL)}</strong> (change which categories in Rules &amp; Settings). Categories you set by hand are never changed.</p>
      <div class="row">
        <label>Home state(s) <input id="home-states" value="${esc((state.settings.homeStates || []).join(', '))}" placeholder="${esc(home.join(', ') || 'e.g. CA')}" size="10"></label>
        <span class="muted small">${state.settings.homeStates && state.settings.homeStates.length ? '' : `Auto-detected: ${esc(home.join(', ') || 'unknown')}. `}In-person purchases outside these states signal a trip.</span>
        <label><input type="checkbox" id="auto-trips" ${state.settings.autoTrips !== false ? 'checked' : ''}> Detect trips automatically</label>
      </div></div>
    <div class="panel"><h3>Add a trip</h3><div class="row">
      <input id="trip-name" placeholder="e.g. Tokyo vacation" size="24"><input type="date" id="trip-start"><input type="date" id="trip-end">
      <button class="primary" data-act="add-trip">Add trip</button></div></div>
    <div class="panel"><h3>My trips (${manual.length})</h3>${manual.length ? `<div class="table-wrap"><table>${head}<tbody>${manualRows}</tbody></table></div>` : '<p class="muted">None yet.</p>'}</div>
    <div class="panel"><h3>Auto-detected trips (${auto.length})</h3>${auto.length ? `<div class="table-wrap"><table>${head}<tbody>${autoRows}</tbody></table></div>` : '<p class="muted">None detected. Hotel or car-rental charges and in-person purchases outside your home state create suggestions here.</p>'}
      ${(state.dismissedTrips || []).length ? `<p class="small"><button class="link" data-act="undismiss">Restore ${state.dismissedTrips.length} dismissed suggestion(s)</button></p>` : ''}</div>`;
  }

  // ---------------------------------------------------------------- receipts
  function renderReceipts() {
    if (!state.receipts.length) return empty('No receipts yet — drop an Amazon order history CSV or receipt PDFs on the Import tab.');
    const txById = new Map(state.transactions.map((t) => [t.id, t]));
    const rules = FS.Engine.allRules(state);
    const cards = state.receipts.slice().sort((a, b) => ((a.date || '') < (b.date || '') ? 1 : -1)).map((r) => {
      const linked = (r.txIds || []).map((id) => txById.get(id)).filter(Boolean);
      const candidates = state.transactions.filter((t) => t.amount > 0 && r.total != null && Math.abs(t.amount - r.total) < Math.max(5, r.total * 0.25) && (!r.date || Math.abs(FS.daysBetween(r.date, t.date)) <= 45))
        .sort((a, b) => Math.abs(a.amount - r.total) - Math.abs(b.amount - r.total)).slice(0, 25);
      const opts = [`<option value="">${r.manualTxIds ? '— choose —' : '(auto-match)'}</option>`, '<option value="__none">Not on my statements</option>',
        ...candidates.map((t) => `<option value="${t.id}" ${r.manualTxIds && r.manualTxIds.includes(t.id) ? 'selected' : ''}>${t.date} · ${esc(t.description.slice(0, 40))} · ${money(t.amount)}</option>`)].join('');
      const items = (r.items || []).map((it, i) => `<tr><td class="desc">${esc(it.name)}</td><td class="num">${money(it.amount)}</td>
        <td><select data-act="item-cat" data-idx="${i}">${categoryOptions(it.manualCategory, { auto: true }).replace('<option value="">(auto)</option>', `<option value="">(auto: ${esc(FS.Engine.itemCategory({ name: it.name }, rules, r.manualCategory || 'Shopping'))})</option>`)}</select></td></tr>`).join('');
      return `<div class="panel" data-receipt="${r.id}">
        <div class="row"><strong>${esc(r.merchant)}</strong><span class="muted">${esc(r.orderId || '')}</span><span>${esc(r.date || 'no date')}</span><strong>${money(r.total)}</strong>
          ${linked.length ? `<span class="badge receipt">✓ matched: ${linked.map((t) => `${t.date} ${esc(t.description.slice(0, 30))} ${money(t.amount)}`).join('; ')}</span>` : `<span class="badge default">not matched</span>`}
          <span style="flex:1"></span><button class="mini danger" data-act="del-receipt">Delete</button></div>
        <div class="row small"><label>Link to transaction <select data-act="link-receipt">${opts}</select></label>
          ${!(r.items || []).length ? `<label>Category for this receipt <select data-act="receipt-cat">${categoryOptions(r.manualCategory, { auto: true })}</select></label>` : ''}</div>
        ${items ? `<table><thead><tr><th>Item</th><th class="num">Price</th><th>Category</th></tr></thead><tbody>${items}</tbody></table>` : ''}
      </div>`;
    }).join('');
    const matched = state.receipts.filter((r) => (r.txIds || []).length).length;
    return `<p class="muted">${matched} of ${state.receipts.length} receipts matched. Matching uses the exact amount and a date window around the order/ship date; for Amazon it also requires an Amazon charge. Item categories feed straight into the matched transaction's split.</p>${cards}`;
  }

  // ---------------------------------------------------------------- settings
  function renderSettings() {
    const builtin = FS.Categories.defaultRules();
    const disabled = new Set(state.disabledBuiltins || []);
    const q = (ui.ruleSearch || '').toLowerCase();
    const shown = builtin.filter((r) => !q || r.pattern.includes(q) || r.category.toLowerCase().includes(q)).slice(0, 300);
    return `<div class="grid2">
      <div class="panel"><h2>Categories</h2>
        <table><thead><tr><th>Name</th><th>Color</th><th title="Not counted as spending">Not spending</th><th></th></tr></thead><tbody>
        ${state.categories.map((c, i) => `<tr data-cat-idx="${i}"><td><input data-field="name" value="${esc(c.name)}" size="22"></td><td><input type="color" data-field="color" value="${c.color}"></td>
          <td><input type="checkbox" data-field="excluded" ${c.excluded ? 'checked' : ''}></td><td>${c.name === 'Other' ? '' : '<button class="mini danger" data-act="del-cat">Delete</button>'}</td></tr>`).join('')}
        </tbody></table>
        <div class="row" style="margin-top:10px"><input id="new-cat" placeholder="New category name"><button data-act="add-cat">Add category</button></div>
        <h3>During a trip, move these categories to ${esc(FS.Categories.TRAVEL)}</h3>
        <div class="chips">${state.categories.filter((c) => c.name !== FS.Categories.TRAVEL && !c.excluded).map((c) => `<label class="chip"><input type="checkbox" data-trip-cat="${esc(c.name)}" ${(state.settings.tripCategories || []).includes(c.name) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>
      </div>
      <div class="panel"><h2>My rules</h2>
        <p class="muted small">Your rules always beat the built-in ones. "Merchant" rules match statement descriptions; "Receipt item" rules match product names on receipts. Keywords match whole words, case-insensitive; wrap in /…/ for a regular expression.</p>
        <div class="row"><input id="rule-pattern" placeholder="keyword, e.g. costco" size="18"><select id="rule-kind"><option value="merchant">Merchant</option><option value="item">Receipt item</option></select>
          <select id="rule-cat">${categoryOptions('Grocery')}</select><button class="primary" data-act="add-rule">Add rule</button></div>
        ${state.rules.length ? `<table><thead><tr><th>Keyword</th><th>Applies to</th><th>Category</th><th></th></tr></thead><tbody>
          ${state.rules.map((r, i) => `<tr data-rule-idx="${i}"><td><code>${esc(r.pattern)}</code></td><td>${r.kind === 'item' ? 'Receipt item' : 'Merchant'}</td><td>${esc(r.category)}</td><td><button class="mini danger" data-act="del-rule">Delete</button></td></tr>`).join('')}
        </tbody></table>` : '<p class="muted">No rules yet. Use "Always…" on the Transactions tab to create them quickly.</p>'}
      </div></div>
      <div class="panel"><h2>Built-in keywords (${builtin.length})</h2>
        <div class="row"><input id="rule-search" placeholder="Filter keywords or category" value="${esc(ui.ruleSearch || '')}"><span class="muted small">Untick a keyword to stop using it.</span></div>
        <div class="table-wrap" style="max-height:40vh"><table><thead><tr><th>On</th><th>Keyword</th><th>Applies to</th><th>Category</th></tr></thead><tbody>
        ${shown.map((r) => `<tr><td><input type="checkbox" data-builtin="${esc(r.kind + ':' + r.pattern)}" ${disabled.has(r.kind + ':' + r.pattern) ? '' : 'checked'}></td><td><code>${esc(r.pattern)}</code></td><td>${r.kind === 'item' ? 'Receipt item' : 'Merchant'}</td><td>${esc(r.category)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
  }

  function empty(msg) { return `<div class="panel empty">${esc(msg)}</div>`; }

  // ------------------------------------------------------------------ render
  const RENDER = { import: renderImport, accounts: renderAccounts, summary: renderSummary, categories: renderCategories, transactions: renderTransactions, trips: renderTrips, receipts: renderReceipts, settings: renderSettings };

  function renderFilters() {
    const accts = new Map();
    state.statements.forEach((s) => accts.set(accountKey(s), accountLabel(s)));
    if (ui.account && !accts.has(ui.account)) ui.account = '';
    $('#f-account').innerHTML = `<option value="">All accounts</option>` + [...accts].map(([k, v]) => `<option value="${esc(k)}" ${k === ui.account ? 'selected' : ''}>${esc(v)}</option>`).join('');
    const months = [...new Set(state.transactions.map((t) => t.date.slice(0, 7)))].sort().reverse();
    if (ui.month && !months.includes(ui.month)) ui.month = '';
    $('#f-month').innerHTML = `<option value="">All months</option>` + months.map((m) => `<option ${m === ui.month ? 'selected' : ''}>${m}</option>`).join('');
    $('#f-info').textContent = `${filteredTx().length} transactions in view`;
  }

  function render() {
    renderFilters();
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
    const focusId = document.activeElement && document.activeElement.id;
    const caret = focusId && document.activeElement.selectionStart;
    $('#view').innerHTML = RENDER[ui.tab]();
    if (focusId && $('#' + focusId) && $('#' + focusId).tagName === 'INPUT') {
      const el = $('#' + focusId); el.focus();
      if (caret != null && el.setSelectionRange) try { el.setSelectionRange(caret, caret); } catch (e) { /* date inputs */ }
    }
  }

  // ------------------------------------------------------------------ events
  function suggestKeyword(desc) {
    const cleaned = desc.toUpperCase().replace(/^(SQ|TST|SP|PY|PP|DD|IN|PAYPAL)\s?\*\s?/, '').replace(/[#*]\S*/g, ' ').replace(/\d+/g, ' ').replace(/[^A-Z&' .-]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned.split(' ').filter((w) => w.length > 1).slice(0, 2).join(' ').toLowerCase();
  }

  function onClick(e) {
    const tabBtn = e.target.closest('#tabs button');
    if (tabBtn) { ui.tab = tabBtn.dataset.tab; render(); return; }
    const catTab = e.target.closest('[data-cat-tab]');
    if (catTab) { ui.catTab = catTab.dataset.catTab; render(); return; }
    const gotoCat = e.target.closest('[data-goto-cat]');
    if (gotoCat) { ui.catTab = gotoCat.dataset.gotoCat; ui.tab = 'categories'; render(); return; }
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.tagName === 'SELECT') return;
    const act = btn.dataset.act;
    const stmtRow = btn.closest('[data-stmt]');
    const txRow = btn.closest('[data-tx]');

    if (act === 'del-stmt') {
      const s = state.statements.find((x) => x.id === stmtRow.dataset.stmt);
      if (!confirm(`Delete ${s.fileName} and its transactions?`)) return;
      state.statements = state.statements.filter((x) => x !== s);
      state.transactions = state.transactions.filter((t) => t.statementId !== s.id);
      commit('Statement deleted');
    } else if (act === 'flip-stmt') {
      state.transactions.forEach((t) => { if (t.statementId === stmtRow.dataset.stmt) t.amount = -t.amount; });
      commit('Signs flipped for this statement');
    } else if (act === 'make-rule') {
      const t = state.transactions.find((x) => x.id === txRow.dataset.tx);
      const pattern = prompt('Keyword that identifies this merchant (matches whole words, any case):', suggestKeyword(t.description));
      if (!pattern) return;
      const cat = $('select[data-act="set-cat"]', txRow).value || t.category;
      const chosen = prompt(`Category for "${pattern}"? (one of: ${state.categories.map((c) => c.name).join(', ')})`, cat === 'Split' ? 'Shopping' : cat);
      if (!chosen) return;
      const match = state.categories.find((c) => c.name.toLowerCase() === chosen.trim().toLowerCase());
      if (!match) { toast(`Unknown category "${chosen}"`); return; }
      state.rules.push({ pattern: pattern.trim().toLowerCase(), category: match.name, kind: 'merchant' });
      if (t.manualCategory === match.name) delete t.manualCategory;
      commit(`Rule added: "${pattern}" → ${match.name}`);
    } else if (act === 'add-trip') {
      const name = $('#trip-name').value.trim() || 'Trip', start = $('#trip-start').value, end = $('#trip-end').value || start;
      if (!start) { toast('Pick a start date'); return; }
      state.trips.push({ id: FS.uid('trip'), name, start: start <= end ? start : end, end: start <= end ? end : start });
      commit('Trip added');
    } else if (act === 'del-trip') {
      state.trips = state.trips.filter((t) => t.id !== btn.closest('[data-trip]').dataset.trip);
      commit('Trip deleted');
    } else if (act === 'keep-trip' || act === 'dismiss-trip') {
      const key = btn.closest('[data-auto-trip]').dataset.autoTrip;
      const a = state.computed.autoTrips.find((x) => x.key === key);
      if (act === 'keep-trip') state.trips.push({ id: FS.uid('trip'), name: a.name, start: a.start, end: a.end });
      else state.dismissedTrips.push(key);
      commit(act === 'keep-trip' ? 'Trip saved — you can edit its name and dates now' : 'Suggestion dismissed');
    } else if (act === 'undismiss') {
      state.dismissedTrips = [];
      commit();
    } else if (act === 'del-receipt') {
      state.receipts = state.receipts.filter((r) => r.id !== btn.closest('[data-receipt]').dataset.receipt);
      commit('Receipt deleted');
    } else if (act === 'add-cat') {
      const name = $('#new-cat').value.trim();
      if (!name || state.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) { toast('Enter a new, unique name'); return; }
      const palette = ['#5e35b1', '#00897b', '#f4511e', '#3949ab', '#7cb342', '#d81b60', '#8d6e63', '#039be5'];
      state.categories.splice(state.categories.findIndex((c) => c.name === 'Other'), 0, { name, color: palette[state.categories.length % palette.length] });
      commit(`Category "${name}" added`);
    } else if (act === 'del-cat') {
      const i = +btn.closest('[data-cat-idx]').dataset.catIdx;
      const name = state.categories[i].name;
      if (!confirm(`Delete category "${name}"? Its transactions will be re-categorized automatically.`)) return;
      state.categories.splice(i, 1);
      state.transactions.forEach((t) => { if (t.manualCategory === name) delete t.manualCategory; });
      state.rules = state.rules.filter((r) => r.category !== name);
      state.settings.tripCategories = (state.settings.tripCategories || []).filter((c) => c !== name);
      commit('Category deleted');
    } else if (act === 'add-rule') {
      const pattern = $('#rule-pattern').value.trim().toLowerCase();
      if (!pattern) { toast('Type a keyword'); return; }
      state.rules.push({ pattern, kind: $('#rule-kind').value, category: $('#rule-cat').value });
      commit(`Rule added: "${pattern}"`);
    } else if (act === 'del-rule') {
      state.rules.splice(+btn.closest('[data-rule-idx]').dataset.ruleIdx, 1);
      commit('Rule deleted');
    }
  }

  function onChange(e) {
    const el = e.target;
    if (el.id === 'f-account') { ui.account = el.value; render(); return; }
    if (el.id === 'f-month') { ui.month = el.value; render(); return; }
    if (el.id === 'tx-cat') { ui.txCat = el.value; render(); return; }
    if (el.dataset.input) { importFiles(el.dataset.input, [...el.files]); el.value = ''; return; }
    if (el.id === 'restore-file') { restore(el.files[0]); el.value = ''; return; }

    const stmtRow = el.closest('[data-stmt]');
    if (stmtRow && el.dataset.field) {
      const s = state.statements.find((x) => x.id === stmtRow.dataset.stmt);
      s[el.dataset.field] = el.dataset.field === 'last4' ? el.value.replace(/\D/g, '').slice(0, 4) : el.value.trim();
      commit('Saved'); return;
    }
    const txRow = el.closest('[data-tx]');
    if (txRow && el.dataset.act === 'set-cat') {
      const t = state.transactions.find((x) => x.id === txRow.dataset.tx);
      if (el.value) t.manualCategory = el.value; else delete t.manualCategory;
      commit(el.value ? `Set to ${el.value}` : 'Back to automatic'); return;
    }
    const tripRow = el.closest('[data-trip]');
    if (tripRow && el.dataset.field) {
      const t = state.trips.find((x) => x.id === tripRow.dataset.trip);
      t[el.dataset.field] = el.value;
      if (t.start > t.end) [t.start, t.end] = [t.end, t.start];
      commit('Trip updated'); return;
    }
    if (el.id === 'home-states') {
      state.settings.homeStates = el.value.toUpperCase().split(/[^A-Z]+/).filter((s) => FS.US_STATES.has(s));
      commit('Home state saved'); return;
    }
    if (el.id === 'auto-trips') { state.settings.autoTrips = el.checked; commit(); return; }
    const rc = el.closest('[data-receipt]');
    if (rc) {
      const r = state.receipts.find((x) => x.id === rc.dataset.receipt);
      if (el.dataset.act === 'link-receipt') {
        if (!el.value) delete r.manualTxIds;
        else r.manualTxIds = el.value === '__none' ? [] : [el.value];
        commit('Receipt link updated');
      } else if (el.dataset.act === 'item-cat') {
        const it = r.items[+el.dataset.idx];
        if (el.value) it.manualCategory = el.value; else delete it.manualCategory;
        commit('Item category saved');
      } else if (el.dataset.act === 'receipt-cat') {
        if (el.value) r.manualCategory = el.value; else delete r.manualCategory;
        commit('Receipt category saved');
      }
      return;
    }
    const catRow = el.closest('[data-cat-idx]');
    if (catRow) {
      const c = state.categories[+catRow.dataset.catIdx];
      const f = el.dataset.field;
      if (f === 'name') {
        const name = el.value.trim();
        if (!name || state.categories.some((x) => x !== c && x.name.toLowerCase() === name.toLowerCase())) { toast('Name must be unique'); render(); return; }
        const old = c.name;
        c.name = name;
        state.transactions.forEach((t) => { if (t.manualCategory === old) t.manualCategory = name; });
        state.rules.forEach((r) => { if (r.category === old) r.category = name; });
        state.receipts.forEach((r) => { if (r.manualCategory === old) r.manualCategory = name; (r.items || []).forEach((i) => { if (i.manualCategory === old) i.manualCategory = name; }); });
        state.settings.tripCategories = (state.settings.tripCategories || []).map((x) => (x === old ? name : x));
        if (old === FS.Categories.TRAVEL || old === FS.Categories.RESTAURANT) toast('Note: built-in keywords still point to the original name; add your own rules for the renamed category.');
      } else if (f === 'color') c.color = el.value;
      else if (f === 'excluded') c.excluded = el.checked;
      commit(); return;
    }
    if (el.dataset.tripCat) {
      const set = new Set(state.settings.tripCategories || []);
      if (el.checked) set.add(el.dataset.tripCat); else set.delete(el.dataset.tripCat);
      state.settings.tripCategories = [...set];
      commit(); return;
    }
    if (el.dataset.builtin) {
      const set = new Set(state.disabledBuiltins || []);
      if (el.checked) set.delete(el.dataset.builtin); else set.add(el.dataset.builtin);
      state.disabledBuiltins = [...set];
      commit(); return;
    }
  }

  function onInput(e) {
    if (e.target.id === 'tx-search') { ui.search = e.target.value; render(); }
    if (e.target.id === 'rule-search') { ui.ruleSearch = e.target.value; render(); }
  }

  function importFiles(kind, files) {
    if (!files.length) return;
    toast(`Reading ${files.length} file(s)…`);
    return kind === 'receipts' ? importReceipts(files) : importStatements(files);
  }

  function setupDrop() {
    document.addEventListener('dragover', (e) => {
      const z = e.target.closest && e.target.closest('[data-drop]');
      e.preventDefault();
      document.querySelectorAll('[data-drop]').forEach((d) => d.classList.toggle('over', d === z));
    });
    document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.querySelectorAll('[data-drop]').forEach((d) => d.classList.remove('over')); });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-drop]').forEach((d) => d.classList.remove('over'));
      const z = e.target.closest && e.target.closest('[data-drop]');
      if (z) importFiles(z.dataset.drop, [...e.dataTransfer.files]);
    });
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function restore(file) {
    if (!file) return;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj || !Array.isArray(obj.transactions)) throw new Error('not a workspace backup');
      if (!confirm('Replace everything in this browser with the backup?')) return;
      state = FS.Store.normalize(obj);
      commit('Backup restored');
    } catch (e) { toast('Restore failed: ' + e.message); }
  }

  function init() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('input', onInput);
    setupDrop();
    $('#btn-export').addEventListener('click', () => {
      const txs = filteredTx();
      if (!txs.length) { toast('Nothing to export yet'); return; }
      const name = FS.Export.exportExcel(state, txs.slice().reverse(), filterLabel());
      toast(`Saved ${name}`);
    });
    $('#btn-backup').addEventListener('click', () => download(`statement-categorizer-backup-${new Date().toISOString().slice(0, 10)}.json`, FS.Store.serialize(state), 'application/json'));
    $('#btn-clear').addEventListener('click', () => {
      if (!confirm('Delete ALL statements, receipts, trips and rules from this browser? (Export a backup first if you want to keep them.)')) return;
      FS.Store.clear();
      state = FS.Store.emptyState();
      ui.importLog = [];
      commit('All data cleared');
    });
    if (state.transactions.length) ui.tab = 'summary';
    FS.Engine.recompute(state);
    render();
  }

  FS.App = { get state() { return state; }, ui, render, importStatements, importReceipts };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
