// End-to-end test: opens index.html from disk in headless Chromium, imports
// the fictional samples, checks categorisation, and exports Excel.
//   node tests/e2e.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const S = (f) => path.join(ROOT, 'samples', f);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  const requests = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith('file:') && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) requests.push(r.url()); });

  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => window.FS && window.FS.App);

  await page.setInputFiles('input[data-input="statements"]', [
    S('Chase_Sapphire_Statement_2026-10.pdf'), S('BankOfAmerica_Checking_Statement_2026-10.pdf'), S('capital_one_quicksilver_2026-10.csv'),
  ]);
  await page.waitForFunction(() => FS.App.state.statements.length === 3, null, { timeout: 15000 });
  await page.setInputFiles('input[data-input="receipts"]', [S('amazon_Retail.OrderHistory.1.csv'), S('amazon_invoice_333-3333333.pdf')]);
  await page.waitForFunction(() => FS.App.state.receipts.length === 3, null, { timeout: 15000 });
  await page.waitForTimeout(300);

  const st = await page.evaluate(() => JSON.parse(JSON.stringify(FS.App.state)));
  const accounts = st.statements.map((s) => `${s.bank} ${s.last4} ${s.accountType} ${s.periodStart}..${s.periodEnd} n=${st.transactions.filter((t) => t.statementId === s.id).length}`);
  console.log('Accounts:\n  ' + accounts.join('\n  '));

  const tx = (re) => {
    const t = st.transactions.find((x) => re.test(x.description));
    assert(t, 'missing transaction ' + re);
    return t;
  };
  const expect = (re, cat) => {
    const t = tx(re);
    assert.strictEqual(t.category, cat, `${t.description}: expected ${cat}, got ${t.category} (${t.source})`);
  };

  // 1. Bank + last 4
  const byBank = Object.fromEntries(st.statements.map((s) => [s.bank, s]));
  assert.strictEqual(byBank['Chase'].last4, '4821');
  assert.strictEqual(byBank['Bank of America'].last4, '7733');
  assert.strictEqual(byBank['Capital One'].last4, '9912');
  assert.strictEqual(byBank['Chase'].accountType, 'Credit Card');
  assert.strictEqual(byBank['Chase'].periodEnd, '2026-10-14');
  assert.strictEqual(st.transactions.filter((t) => t.statementId === byBank['Chase'].id).length, 27);
  assert.strictEqual(st.transactions.filter((t) => t.statementId === byBank['Bank of America'].id).length, 9);

  // Signs: payment in, purchases out
  assert(tx(/Payment Thank You/).amount < 0, 'card payment should be money in');
  assert(tx(/MARRIOTT/).amount > 0);
  assert(tx(/PAYROLL/).amount < 0, 'payroll should be money in');
  assert(tx(/SAFEWAY/).amount === 112.34, 'balance column must not be read as the amount');
  assert(tx(/AUTOPAY PYMT/).amount < 0);
  assert(tx(/KROGER/).amount > 0);

  // 2. Categories
  expect(/WHOLEFDS/, 'Grocery');
  expect(/TRADER JOE/, 'Grocery');
  expect(/NETFLIX/, 'Entertainment Sub');
  expect(/SPOTIFY/, 'Entertainment Sub');
  expect(/DISNEY PLUS/, 'Entertainment Sub');
  expect(/OPENAI/, 'AI Tool Sub');
  expect(/CLAUDE\.AI/, 'AI Tool Sub');
  expect(/MIDJOURNEY/, 'AI Tool Sub');
  expect(/PLANET FITNESS/, 'Fitness Club');
  expect(/EQUINOX/, 'Fitness Club');
  expect(/ALASKA AIR/, 'Travel (Hotel & Trans)');
  expect(/MARRIOTT/, 'Travel (Hotel & Trans)');
  expect(/UBER \*TRIP/, 'Travel (Hotel & Trans)');
  expect(/TARGET/, 'Shopping');
  expect(/KAISER/, 'Medical');
  expect(/CVS/, 'Medical');
  expect(/DICK'S DRIVE-IN/, 'Restaurant/Eat Out');
  expect(/STARBUCKS/, 'Restaurant/Eat Out');
  expect(/MCDONALD/, 'Restaurant/Eat Out');
  expect(/PHO BAC/, 'Restaurant/Eat Out');
  expect(/NOODLE/, 'Restaurant/Eat Out');
  expect(/SHELL OIL/, 'Gas & Auto');
  expect(/Payment Thank You/, 'Payments & Transfers');
  expect(/PAYROLL/, 'Income');
  expect(/CHASE CREDIT CRD/, 'Payments & Transfers');
  expect(/MYSTERY MERCHANT/, 'Other');

  // 4. Restaurants during the San Diego trip become Travel
  const trips = st.computed.autoTrips;
  console.log('Trips:', trips.map((t) => `${t.name} ${t.start}..${t.end}`));
  assert.deepStrictEqual(st.computed.homeStates, ['WA']);
  assert(trips.some((t) => /San Diego/.test(t.name) && t.start <= '2026-10-03' && t.end >= '2026-10-07'), 'San Diego trip not detected');
  for (const re of [/HODAD/, /PHIL'S BBQ/, /BREAKFAST REPUBLIC/]) {
    const t = tx(re);
    assert.strictEqual(t.category, 'Travel (Hotel & Trans)', t.description);
    assert.strictEqual(t.source, 'trip');
  }
  expect(/GIFT SHOP/, 'Other'); // not a restaurant → stays as is
  expect(/MCDONALD/, 'Restaurant/Eat Out'); // after the trip

  // 3. Receipts split Amazon charges
  const a1 = tx(/NK3L09XY2/);
  assert.strictEqual(a1.source, 'receipt');
  const cats = Object.fromEntries(a1.splits.map((s) => [s.category, s.amount]));
  assert.deepStrictEqual(cats, { Medical: 20.7, Grocery: 15.79, Shopping: 20.82 });
  assert.strictEqual(tx(/AB12CD34E/).source, 'receipt');
  const a3 = tx(/ZZ99YY88/);
  assert.strictEqual(a3.source, 'receipt', 'Amazon invoice PDF should match the Capital One charge');
  assert(a3.splits.some((s) => s.category === 'Medical'), 'Advil should be Medical');
  assert.strictEqual(Math.round(a3.splits.reduce((s, x) => s + x.amount, 0) * 100), 3636);

  // Manual override + rule
  await page.click('#tabs button[data-tab="transactions"]');
  const mysteryRow = await page.locator('tr', { hasText: 'MYSTERY MERCHANT' });
  await mysteryRow.locator('select[data-act="set-cat"]').selectOption('Shopping');
  await page.waitForTimeout(100);
  const mc = await page.evaluate(() => FS.App.state.transactions.find((t) => /MYSTERY/.test(t.description)).category);
  assert.strictEqual(mc, 'Shopping');

  // Every tab renders without errors
  for (const tab of ['import', 'accounts', 'summary', 'categories', 'transactions', 'trips', 'receipts', 'settings']) {
    await page.click(`#tabs button[data-tab="${tab}"]`);
    await page.waitForTimeout(50);
  }
  await page.click('#tabs button[data-tab="summary"]');
  await page.screenshot({ path: path.join(os.tmpdir(), 'finance-summary.png'), fullPage: true });

  // Excel export
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-export')]);
  const out = path.join(os.tmpdir(), dl.suggestedFilename());
  await dl.saveAs(out);
  const XLSX = require(path.join(ROOT, 'vendor', 'xlsx.full.min.js'));
  const wb = XLSX.read(fs.readFileSync(out));
  console.log('Excel sheets:', wb.SheetNames.join(', '));
  for (const s of ['Accounts', 'Summary', 'Transactions', 'Grocery', 'Travel (Hotel & Trans)', 'Restaurant-Eat Out', 'Trips', 'Receipts']) {
    assert(wb.SheetNames.includes(s), 'missing sheet ' + s);
  }
  const acc = XLSX.utils.sheet_to_json(wb.Sheets['Accounts']);
  assert(acc.some((r) => r.Bank === 'Chase' && String(r['Last 4']) === '4821'));

  // Persistence across reload
  await page.reload();
  await page.waitForFunction(() => window.FS && FS.App);
  const n = await page.evaluate(() => FS.App.state.transactions.length);
  assert.strictEqual(n, st.transactions.length);

  assert.deepStrictEqual(errors, [], 'page errors: ' + errors.join('\n'));
  assert.deepStrictEqual(requests, [], 'unexpected network requests: ' + requests.join(', '));
  await browser.close();
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
