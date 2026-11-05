/* Turns statement text (from PDF) or CSV rows into transactions, and detects
 * the bank name, last 4 digits of the account, and the statement period. */
(function (root) {
  'use strict';
  const FS = root.FS;

  // [display name, regex]. The bank mentioned most often wins.
  const BANKS = [
    ['Chase', /\bJ\.?P\.?\s?MORGAN CHASE\b|\bCHASE\b|chase\.com/i],
    ['Bank of America', /\bBANK OF AMERICA\b|bankofamerica\.com/i],
    ['Wells Fargo', /\bWELLS FARGO\b|wellsfargo\.com/i],
    ['Citi', /\bCITIBANK\b|\bCITI\b|citi\.com|citicards/i],
    ['Capital One', /\bCAPITAL ONE\b|capitalone\.com/i],
    ['American Express', /\bAMERICAN EXPRESS\b|\bAMEX\b|americanexpress\.com/i],
    ['Discover', /\bDISCOVER (BANK|CARD|IT)\b|discover\.com/i],
    ['U.S. Bank', /\bU\.?S\.? BANK\b|usbank\.com/i],
    ['PNC', /\bPNC\b/i],
    ['TD Bank', /\bTD BANK\b/i],
    ['Truist', /\bTRUIST\b/i],
    ['Ally', /\bALLY BANK\b|ally\.com/i],
    ['USAA', /\bUSAA\b/i],
    ['Navy Federal', /\bNAVY FEDERAL\b/i],
    ['Charles Schwab', /\bSCHWAB\b/i],
    ['Fidelity', /\bFIDELITY\b/i],
    ['HSBC', /\bHSBC\b/i],
    ['Barclays', /\bBARCLAYS\b/i],
    ['Synchrony', /\bSYNCHRONY\b/i],
    ['Apple Card', /\bAPPLE CARD\b|GOLDMAN SACHS/i],
    ['Marcus', /\bMARCUS\b/i],
    ['SoFi', /\bSOFI\b/i],
    ['Chime', /\bCHIME\b/i],
    ['Citizens', /\bCITIZENS BANK\b/i],
    ['Fifth Third', /\bFIFTH THIRD\b/i],
    ['KeyBank', /\bKEYBANK\b/i],
    ['Regions', /\bREGIONS BANK\b/i],
    ['Huntington', /\bHUNTINGTON\b/i],
    ['M&T Bank', /\bM&T BANK\b/i],
    ['BMO', /\bBMO\b/i],
    ['East West Bank', /\bEAST WEST BANK\b/i],
    ['Cathay Bank', /\bCATHAY BANK\b/i],
    ['First Republic', /\bFIRST REPUBLIC\b/i],
    ['Frost', /\bFROST BANK\b/i],
  ];

  function detectBank(text, fileName) {
    // Ignore transaction lines: a checking statement paying a "CHASE CREDIT CRD"
    // bill must not be detected as Chase.
    text = text.split('\n').filter((l) => !(DATE_START.test(l.trim()) && /\d\.\d{2}\b/.test(l))).join('\n');
    const head = text.slice(0, 1500);
    let best = null, bestScore = 0;
    for (const [name, re] of BANKS) {
      const g = new RegExp(re.source, 'gi');
      const score = (head.match(g) || []).length * 3 + (text.match(g) || []).length;
      if (score > bestScore) { best = name; bestScore = score; }
    }
    if (!best && fileName) {
      for (const [name, re] of BANKS) if (re.test(fileName.replace(/[_\-]/g, ' '))) return name;
      const f = fileName.toLowerCase();
      if (/^chase/.test(f)) return 'Chase';
      if (/^stmt|bofa/.test(f)) return 'Bank of America';
    }
    return best;
  }

  function detectLast4(text, fileName) {
    const pats = [
      /(?:ending in|ending|ends in|account ending)\s*[:#]?\s*[\dxX*•\-]*?(\d{4,5})\b/i,
      /(?:account|acct\.?|card)\s*(?:number|no\.?|#)?\s*[:#]?\s*((?:[xX*•]+[\s\-]?)+\d{4})\b/i,
      /(?:account|acct\.?|card)\s*(?:number|no\.?|#)\s*[:#]?\s*((?:\d{3,4}[\s\-]?){1,4}\d{4})\b/i,
      /[xX*•]{2,}[\s\-]*(\d{4})\b/,
    ];
    for (const re of pats) {
      const m = text.match(re);
      if (m) { const d = m[1].replace(/\D/g, ''); if (d.length >= 4) return d.slice(-4); }
    }
    if (fileName) {
      const m = fileName.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/);
      if (m && !/^(19|20)\d\d$/.test(m[1])) return m[1];
    }
    return '';
  }

  const MONTH_NAME = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';

  function detectPeriod(text) {
    const sep = '\\s*(?:-|–|—|to|through|thru)\\s*';
    const num = '(\\d{1,2}/\\d{1,2}/\\d{2,4})';
    const named = `(${MONTH_NAME}\\.?\\s+\\d{1,2},?\\s+\\d{4})`;
    const namedNoYear = `(${MONTH_NAME}\\.?\\s+\\d{1,2})`;
    let m = text.match(new RegExp(num + sep + num));
    if (m) return { start: FS.parseDate(m[1]), end: FS.parseDate(m[2]) };
    m = text.match(new RegExp(named + sep + named, 'i'));
    if (m) return { start: FS.parseDate(m[1]), end: FS.parseDate(m[2]) };
    m = text.match(new RegExp(namedNoYear + sep + named, 'i'));
    if (m) {
      const end = FS.parseDate(m[2]);
      let start = FS.parseDate(m[1], +end.slice(0, 4));
      if (start > end) start = FS.parseDate(m[1], +end.slice(0, 4) - 1);
      return { start, end };
    }
    m = text.match(/(?:closing date|statement date|period ending|as of)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/i);
    if (m) return { start: null, end: FS.parseDate(m[1]) };
    return { start: null, end: null };
  }

  function detectAccountType(text) {
    if (/credit limit|minimum payment|payment due date|credit card|available credit|cash advance/i.test(text)) return 'Credit Card';
    if (/savings/i.test(text) && !/checking/i.test(text)) return 'Savings';
    if (/checking|deposits|withdrawals|beginning balance/i.test(text)) return 'Checking';
    return '';
  }

  // Lines that look like transactions but aren't.
  const SKIP_DESC = /\b(beginning balance|ending balance|balance forward|previous balance|new balance|opening balance|closing balance|total|subtotal|daily balance|minimum payment|payment due|credit limit|available credit|statement balance|interest charged|annual percentage|account summary|page \d)/i;

  const CREDIT_HEADER = /(deposits|additions|payments,? (and |& )?(other )?credits|other credits|credits|refunds|money in)/i;
  const DEBIT_HEADER = /(withdrawals|subtractions|purchases?|debits|checks paid|^checks$|fees charged|atm & debit|card transactions|electronic payments|money out|charges|new charges|purchases and adjustments)/i;
  const CREDIT_WORDS = /\b(PAYMENT THANK YOU|PAYMENT - THANK YOU|AUTOPAY PAYMENT|PAYROLL|DIRECT DEP|DEPOSIT|REFUND|RETURN|CREDIT ADJ|INTEREST PAID|TRANSFER FROM|CASHBACK|CASH BACK REWARD|REVERSAL)\b/i;

  const DATE_START = new RegExp(`^(\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?|${MONTH_NAME}\\.?\\s+\\d{1,2}(?:,?\\s+\\d{4})?|\\d{1,2}\\s+${MONTH_NAME})\\b\\s*`, 'i');
  const AMOUNT_TOKEN = /(?:^|\s)(\(?[-−–+]?\s?\$?\s?\d{1,3}(?:,\d{3})*\.\d{2}\)?(?:\s?CR\b|-)?)(?=\s|$)/gi;

  function yearFor(month, period) {
    const endY = period.end ? +period.end.slice(0, 4) : new Date().getFullYear();
    const endM = period.end ? +period.end.slice(5, 7) : 12;
    return month > endM + 1 ? endY - 1 : endY;
  }

  /** Parse statement text lines into transactions. */
  function parseTextLines(lines, meta) {
    const period = meta.period || { start: null, end: null };
    const isCard = meta.accountType === 'Credit Card';
    let section = null; // 'credit' | 'debit' | null, from the most recent section header
    const rows = [];

    for (const raw of lines) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      const amounts = [...line.matchAll(AMOUNT_TOKEN)].map((m) => m[1]);
      const dm = line.match(DATE_START);

      if (!dm && amounts.length === 0 && line.length < 80) {
        if (CREDIT_HEADER.test(line) && !/balance/i.test(line)) section = 'credit';
        else if (DEBIT_HEADER.test(line)) section = 'debit';
        continue;
      }
      if (!dm || amounts.length === 0) continue;

      let rest = line.slice(dm[0].length);
      const dm2 = rest.match(DATE_START); // optional posting date
      if (dm2) rest = rest.slice(dm2[0].length);

      const lastAmt = amounts[amounts.length - 1];
      let before = rest.slice(0, rest.lastIndexOf(lastAmt)).trim();
      let amtStr = lastAmt;
      if (amounts.length >= 2 && !isCard) {
        // Bank statements often print "amount  running-balance" at the end of a line.
        const prev = amounts[amounts.length - 2];
        const i2 = before.lastIndexOf(prev);
        if (i2 >= 0 && before.slice(i2 + prev.length).trim() === '') {
          amtStr = prev;
          before = before.slice(0, i2).trim();
        }
      }
      const desc = before.replace(/\s+\$$/, '').trim();
      if (desc.length < 2 || SKIP_DESC.test(desc)) continue;

      const value = FS.parseAmount(amtStr.replace(/\s/g, ''));
      if (value == null || value === 0) continue;

      const month = +FS.parseDate(dm[1], 2000).slice(5, 7);
      const date = FS.parseDate(dm[1], yearFor(month, period));
      if (!date) continue;
      rows.push({ date, desc, value, section });
    }

    // Decide the direction of each row. Result: positive = money out, negative = money in.
    const unsectionedNeg = rows.some((r) => !r.section && r.value < 0);
    return rows.map((r) => {
      let isCredit;
      if (isCard) isCredit = r.value < 0 || r.section === 'credit' || (!r.section && CREDIT_WORDS.test(r.desc));
      else if (r.section) isCredit = r.section === 'credit';
      else if (unsectionedNeg) isCredit = r.value > 0; // bank prints withdrawals as negatives
      else isCredit = CREDIT_WORDS.test(r.desc);
      const amt = Math.abs(r.value);
      return { date: r.date, description: r.desc, amount: FS.round2(isCredit ? -amt : amt) };
    });
  }

  /** Statement text (one string per line) → statement object. */
  function parseStatementText(lines, fileName) {
    const text = lines.join('\n');
    const meta = {
      bank: detectBank(text, fileName) || '',
      last4: detectLast4(text, fileName),
      accountType: detectAccountType(text),
      period: detectPeriod(text),
    };
    const transactions = parseTextLines(lines, meta);
    return finishStatement(meta, transactions, fileName, 'pdf');
  }

  function finishStatement(meta, transactions, fileName, format) {
    const dates = transactions.map((t) => t.date).sort();
    return {
      fileName,
      format,
      bank: meta.bank,
      last4: meta.last4,
      accountType: meta.accountType,
      periodStart: meta.period.start || dates[0] || null,
      periodEnd: meta.period.end || dates[dates.length - 1] || null,
      transactions,
    };
  }

  // ---------------------------------------------------------------- CSV

  function findCol(header, patterns, exclude) {
    for (const p of patterns) {
      const i = header.findIndex((h, idx) => p.test(h) && !(exclude && exclude.includes(idx)));
      if (i >= 0) return i;
    }
    return -1;
  }

  function parseStatementCSV(text, fileName) {
    const rows = FS.parseCSV(text);
    // Header = first row that contains a "date" column and an amount-ish column.
    let hi = rows.findIndex((r) => r.some((c) => /date/i.test(c)) && r.some((c) => /amount|debit|credit|withdrawal|deposit/i.test(c)));
    if (hi < 0) throw new Error('Could not find a header row with Date and Amount columns in ' + fileName);
    const preamble = rows.slice(0, hi).map((r) => r.join(' ')).join('\n');
    const header = rows[hi].map((h) => h.trim().toLowerCase());
    const cDate = findCol(header, [/^trans(action)?\.? ?date$/, /^date$/, /^post(ed|ing)? ?date$/, /date/]);
    const cDesc = findCol(header, [/^description$/, /description/, /payee|merchant|name|details|memo|narrative/, /^transaction$/]);
    const cAmt = findCol(header, [/^amount$/, /^amount/, /amount/]);
    const cDebit = findCol(header, [/^debit/, /withdrawal|money out|charge/]);
    const cCredit = findCol(header, [/^credit/, /deposit|money in/]);
    const cCat = findCol(header, [/^category$/, /category/]);
    const cType = findCol(header, [/^type$/, /transaction type/]);
    const cCard = findCol(header, [/card ?no|card number|card last|account number|^account$/]);
    if (cDate < 0 || cDesc < 0 || (cAmt < 0 && cDebit < 0 && cCredit < 0)) {
      throw new Error('Unrecognised CSV columns in ' + fileName + ': ' + rows[hi].join(', '));
    }

    const raw = [];
    for (const r of rows.slice(hi + 1)) {
      const date = FS.parseDate(r[cDate]);
      if (!date) continue;
      const desc = String(r[cDesc] || '').trim();
      let value;
      if (cAmt >= 0 && String(r[cAmt] || '').trim() !== '') value = FS.parseAmount(r[cAmt]);
      else {
        const d = cDebit >= 0 ? FS.parseAmount(r[cDebit]) : null;
        const c = cCredit >= 0 ? FS.parseAmount(r[cCredit]) : null;
        if (d) value = { out: Math.abs(d) };
        else if (c) value = { out: -Math.abs(c) };
        else continue;
      }
      if (value == null) continue;
      raw.push({ date, description: desc, value, bankCategory: cCat >= 0 ? r[cCat] : '', type: cType >= 0 ? r[cType] : '', card: cCard >= 0 ? String(r[cCard] || '').replace(/\D/g, '').slice(-4) : '' });
    }

    // A single signed Amount column: banks disagree on the sign of purchases.
    // Spending entries are the majority on almost every statement, so the
    // majority sign is treated as "money out".
    const signed = raw.filter((t) => typeof t.value === 'number');
    let spendSign = 1;
    if (signed.length) {
      const neg = signed.filter((t) => t.value < 0 && !CREDIT_WORDS.test(t.description)).length;
      const pos = signed.filter((t) => t.value > 0 && !CREDIT_WORDS.test(t.description)).length;
      spendSign = neg > pos ? -1 : 1;
    }
    const transactions = raw.map((t) => ({
      date: t.date,
      description: t.description,
      amount: FS.round2(typeof t.value === 'number' ? t.value * spendSign : t.value.out),
      bankCategory: t.bankCategory || '',
    })).filter((t) => t.amount !== 0);

    const meta = {
      bank: detectBank(preamble, fileName) || detectBank('', fileName) || '',
      last4: mostCommon(raw.map((t) => t.card).filter((c) => c.length === 4)) || detectLast4(preamble, fileName),
      accountType: detectAccountType(preamble) || (raw.some((t) => /sale|payment/i.test(t.type)) || (cCard >= 0 && /card/.test(header[cCard])) ? 'Credit Card' : ''),
      period: detectPeriod(preamble),
    };
    return finishStatement(meta, transactions, fileName, 'csv');
  }

  function mostCommon(list) {
    const counts = {};
    list.forEach((x) => { counts[x] = (counts[x] || 0) + 1; });
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
  }

  FS.Statement = { detectBank, detectLast4, detectPeriod, detectAccountType, parseTextLines, parseStatementText, parseStatementCSV, BANKS };
})(typeof window !== 'undefined' ? window : globalThis);
