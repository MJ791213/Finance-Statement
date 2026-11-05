/* Receipts: Amazon order-history CSV, Amazon order/invoice PDFs, and generic
 * receipt PDFs/text. Receipts are matched to statement transactions by amount
 * and date, and their line items are used to split/re-categorise the charge. */
(function (root) {
  'use strict';
  const FS = root.FS;

  const AMAZON_TX_RE = /AMAZON|AMZN|WHOLE ?FOODS|PRIME/i;

  function isAmazonReceipt(r) { return /amazon/i.test(r.merchant || ''); }

  // ------------------------------------------------------------ Amazon CSV
  // Supports Amazon "Request my data" (Retail.OrderHistory.*.csv) and the
  // older order-report / browser-extension formats.
  function parseAmazonCSV(text, fileName) {
    const rows = FS.parseCSV(text);
    if (!rows.length) return [];
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (...res) => { for (const re of res) { const i = header.findIndex((h) => re.test(h)); if (i >= 0) return i; } return -1; };
    const cOrder = col(/^order id$/, /order id|order number|order #/);
    const cDate = col(/^order date$/, /order date|date/);
    const cShip = col(/^ship date$/, /ship(ment)? date|shipped/);
    const cName = col(/^product name$/, /product name|title|item|description/);
    const cTotal = col(/^total owed$/, /item total|total owed|total charged|^total$|amount|price/);
    const cUnit = col(/^unit price$/, /unit price|purchase price per unit/);
    const cQty = col(/^quantity$/, /qty|quantity/);
    const cStatus = col(/order status/, /status/);
    const cPay = col(/payment instrument|payment method/);
    if (cOrder < 0 || cDate < 0 || cName < 0 || (cTotal < 0 && cUnit < 0)) {
      throw new Error('Unrecognised Amazon CSV columns in ' + fileName + '. Expected Order ID, Order Date, Product Name, Total Owed.');
    }
    const groups = new Map();
    for (const r of rows.slice(1)) {
      if (cStatus >= 0 && /cancel/i.test(r[cStatus] || '')) continue;
      const orderId = (r[cOrder] || '').trim();
      const date = FS.parseDate(r[cDate]);
      if (!orderId || !date) continue;
      const ship = cShip >= 0 ? FS.parseDate(r[cShip]) : null;
      let amount = cTotal >= 0 ? FS.parseAmount(r[cTotal]) : null;
      if (amount == null && cUnit >= 0) amount = (FS.parseAmount(r[cUnit]) || 0) * (cQty >= 0 ? (+r[cQty] || 1) : 1);
      if (amount == null) continue;
      const key = orderId + '|' + (ship || '');
      if (!groups.has(key)) {
        groups.set(key, {
          source: 'amazon-csv', fileName, merchant: 'Amazon', orderId,
          date, shipDate: ship, items: [], payment: cPay >= 0 ? (r[cPay] || '') : '',
        });
      }
      groups.get(key).items.push({ name: (r[cName] || '').trim(), amount: FS.round2(amount) });
    }
    return [...groups.values()].map((g) => {
      g.total = FS.round2(g.items.reduce((s, i) => s + i.amount, 0));
      return g;
    });
  }

  // --------------------------------------------------------- receipt text
  const SUMMARY_LINE = /\b(sub-?total|tax|shipping|handling|total|discount|promotion|coupon|tip|gratuity|payment|balance|change|cash|visa|mastercard|amex|discover|ending in|grand|before tax|savings|refund|gift card|reward|points)\b/i;

  function parseReceiptText(lines, fileName) {
    const text = lines.join('\n');
    const merchant = /amazon/i.test(text) ? 'Amazon' : guessMerchant(lines, fileName);
    const orderId = (text.match(/order\s*(?:#|number|no\.?|id)\s*:?\s*([A-Z0-9][A-Z0-9-]{5,})/i) || [])[1] || '';
    const dateM = text.match(/(?:order placed|order date|date of purchase|purchase date|transaction date|date)\s*:?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/i)
      || text.match(/([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4}|\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/);
    const date = dateM ? FS.parseDate(dateM[1]) : null;

    const totalPats = [
      /grand total\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
      /order total\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
      /(?:total charged|amount charged|total paid|amount paid|charged)\s*:?\s*\$?\s*([\d,]+\.\d{2})/i,
    ];
    let total = null;
    for (const re of totalPats) { const m = text.match(re); if (m) { total = FS.parseAmount(m[1]); break; } }
    if (total == null) {
      const all = [...text.matchAll(/(?:^|\n|\s)total\s*:?\s*\$?\s*([\d,]+\.\d{2})/gi)];
      if (all.length) total = FS.parseAmount(all[all.length - 1][1]);
    }

    // Separate card charges listed on Amazon order details pages.
    const charges = [];
    for (const m of text.matchAll(/ending in\s*(\d{4})\s*:?\s*([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})\s*:?\s*\$\s*([\d,]+\.\d{2})/gi)) {
      charges.push({ last4: m[1], date: FS.parseDate(m[2]), amount: FS.parseAmount(m[3]) });
    }

    const items = [];
    for (const line of lines) {
      const l = line.replace(/\s+/g, ' ').trim();
      let m = l.match(/^(\d+)\s+of:\s*(.+?)\s+\$\s?([\d,]+\.\d{2})$/i);
      if (m) { items.push({ name: m[2], amount: FS.parseAmount(m[3]) }); continue; }
      m = l.match(/^(.{3,120}?)\s+\$?\s?([\d,]+\.\d{2})$/);
      if (m && !SUMMARY_LINE.test(m[1]) && /[A-Za-z]{3,}/.test(m[1]) && !/^\d{1,2}\/\d{1,2}/.test(m[1])) {
        items.push({ name: m[1].replace(/^\d+\s*(x|@)?\s*/i, ''), amount: FS.parseAmount(m[2]) });
      }
    }
    if (total == null && items.length) total = FS.round2(items.reduce((s, i) => s + i.amount, 0));
    return {
      source: 'receipt', fileName, merchant, orderId, date, total: total == null ? null : FS.round2(total),
      charges, items, text: text.slice(0, 4000),
    };
  }

  function guessMerchant(lines, fileName) {
    for (const l of lines.slice(0, 8)) {
      const t = l.trim();
      if (t.length >= 3 && /[A-Za-z]{3}/.test(t) && !/receipt|invoice|order|date|page/i.test(t)) return t.slice(0, 40);
    }
    return (fileName || 'Receipt').replace(/\.[a-z]+$/i, '');
  }

  // ---------------------------------------------------------------- match
  /** Auto-link receipts to transactions. Receipts with a manual link keep it. */
  function matchReceipts(receipts, transactions) {
    const taken = new Set();
    for (const r of receipts) if (r.manualTxIds) r.manualTxIds.forEach((id) => taken.add(id));
    const byAmount = transactions.filter((t) => t.amount > 0);

    function findTx(amount, date, amazon, windowBefore, windowAfter, last4) {
      let best = null, bestScore = Infinity;
      for (const t of byAmount) {
        if (taken.has(t.id) || Math.abs(t.amount - amount) > 0.011) continue;
        if (amazon && !AMAZON_TX_RE.test(t.description)) continue;
        const dd = FS.daysBetween(date, t.date);
        if (dd < -windowBefore || dd > windowAfter) continue;
        const score = Math.abs(dd) - (last4 && t.last4 === last4 ? 5 : 0);
        if (score < bestScore) { best = t; bestScore = score; }
      }
      return best;
    }

    for (const r of receipts) {
      if (r.manualTxIds) { r.txIds = r.manualTxIds.slice(); continue; }
      r.txIds = [];
      if (!r.date || r.total == null) continue;
      const amazon = isAmazonReceipt(r);
      const charges = r.charges && r.charges.length ? r.charges : [{ date: r.shipDate || r.date, amount: r.total }];
      for (const c of charges) {
        const t = findTx(c.amount, c.date || r.date, amazon, r.charges && r.charges.length ? 3 : 4, r.charges && r.charges.length ? 4 : 21, c.last4);
        if (t) { r.txIds.push(t.id); taken.add(t.id); }
      }
    }

    // Amazon CSV: shipments of the same order sometimes appear as one charge.
    const byOrder = new Map();
    for (const r of receipts) {
      if (r.source !== 'amazon-csv' || r.txIds.length || r.manualTxIds) continue;
      if (!byOrder.has(r.orderId)) byOrder.set(r.orderId, []);
      byOrder.get(r.orderId).push(r);
    }
    for (const group of byOrder.values()) {
      if (group.length < 2) continue;
      const total = FS.round2(group.reduce((s, r) => s + r.total, 0));
      const t = findTx(total, group[0].date, true, 4, 21);
      if (t) { taken.add(t.id); group.forEach((r) => { r.txIds = [t.id]; }); }
    }
    return receipts;
  }

  FS.Receipts = { parseAmazonCSV, parseReceiptText, matchReceipts, isAmazonReceipt, AMAZON_TX_RE };
})(typeof window !== 'undefined' ? window : globalThis);
