// End-to-end test: opens index.html from disk in headless Chromium, creates an
// account, imports the fictional samples, checks categorisation, exports
// Excel, and checks that saved data is encrypted and private to each account.
// Supabase is replaced by a fake server that lives in this Node process (so
// data survives reloads and is shared between browser contexts, like a real
// server) and only returns a row to the session that owns it, like RLS.
//   node tests/e2e.test.js
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const S = (f) => path.join(ROOT, 'samples', f);

// ------------------------------------------------------------- fake server
const server = { users: new Map(), rows: new Map(), sessions: new Map(), n: 0 };
function serverCall(op, token, a = {}) {
  const uid = server.sessions.get(token);
  const info = (u) => ({ id: u.id, email: u.email, user_metadata: { display_name: u.name } });
  const login = (u) => { const t = 'tok' + (++server.n); server.sessions.set(t, u.id); return { token: t, user: info(u) }; };
  const me = () => [...server.users.values()].find((u) => u.id === uid);
  switch (op) {
    case 'signUp': {
      if (server.users.has(a.email)) throw new Error('User already registered');
      const u = { id: 'user-' + (++server.n), email: a.email, pw: a.password, name: a.name };
      server.users.set(a.email, u);
      return login(u);
    }
    case 'signIn': {
      const u = server.users.get(a.email);
      if (!u || u.pw !== a.password) throw new Error('Invalid login credentials');
      return login(u);
    }
    case 'getUser': return uid ? info(me()) : null;
    case 'signOut': server.sessions.delete(token); return null;
    case 'updateUser': { const u = me(); if (a.password) u.pw = a.password; if (a.name) u.name = a.name; return info(u); }
    // "RLS": every row operation is scoped to the caller's own user id.
    case 'load': if (!uid) throw new Error('not signed in'); return server.rows.get(uid) || null;
    case 'save': if (!uid) throw new Error('not signed in'); server.rows.set(uid, { ...a, updated_at: new Date().toISOString() }); return null;
    case 'delete': if (!uid) throw new Error('not signed in'); server.rows.delete(uid); return null;
    default: throw new Error('unknown op ' + op);
  }
}

// Runs in the page before the app's scripts: a backend with the same interface
// as js/backend.js that talks to the fake server through a Playwright binding.
function fakeBackendScript() {
  const call = async (op, a) => {
    const r = JSON.parse(await window.__server(op, localStorage.getItem('fake.token'), a || {}));
    if (r.error) throw new Error(r.error);
    return r.value;
  };
  const info = (u) => window.FS.Backend.userInfo(u);
  window.FS_TEST_BACKEND = {
    async getUser() { return info(await call('getUser')); },
    async signUp(email, password, name) { const r = await call('signUp', { email, password, name }); localStorage.setItem('fake.token', r.token); return { user: info(r.user), needsConfirmation: false }; },
    async signIn(email, password) { const r = await call('signIn', { email, password }); localStorage.setItem('fake.token', r.token); return info(r.user); },
    async signOut() { await call('signOut'); localStorage.removeItem('fake.token'); },
    async updatePassword(password) { await call('updateUser', { password }); },
    async updateDisplayName(name) { return info(await call('updateUser', { name })); },
    loadWorkspace: () => call('load'),
    saveWorkspace: (blob) => call('save', blob),
    deleteWorkspace: () => call('delete'),
  };
}

const URL_ = 'file://' + path.join(ROOT, 'index.html');
const errors = [];
const requests = [];

async function newPage(browser) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  await ctx.exposeFunction('__server', (op, token, a) => {
    try { return JSON.stringify({ value: serverCall(op, token, a) }); } catch (e) { return JSON.stringify({ error: e.message }); }
  });
  await ctx.addInitScript(fakeBackendScript);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!/^(file|blob|data):/.test(r.url())) requests.push(r.url()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL_);
  await page.waitForFunction(() => window.FS && FS.App && FS.Auth);
  return page;
}

async function signUp(page, name, email, password) {
  await page.click('[data-auth="to-signup"]');
  await page.fill('#auth-form input[name="name"]', name);
  await page.fill('#auth-form input[name="email"]', email);
  await page.fill('#auth-form input[name="password"]', password);
  await page.fill('#auth-form input[name="password2"]', password);
  await page.click('#auth-form button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#app').hidden, null, { timeout: 15000 });
}

async function signIn(page, email, password) {
  await page.fill('#auth-form input[name="email"]', email);
  await page.fill('#auth-form input[name="password"]', password);
  await page.click('#auth-form button[type="submit"]');
}

const appVisible = (page) => page.waitForFunction(() => !document.querySelector('#app').hidden, null, { timeout: 15000 });
const saved = (page) => page.waitForFunction(() => FS.Store.status === 'saved', null, { timeout: 15000 });

(async () => {
  const browser = await chromium.launch();
  const page = await newPage(browser);

  // Not signed in → login screen, app hidden
  assert.strictEqual(await page.isVisible('#app'), false, 'app must be hidden before login');
  await signUp(page, 'Alice', 'alice@example.com', 'alice-pass-123');
  assert.strictEqual((await page.textContent('#user-name')).trim(), '👤 Alice');

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

  // Saved online, encrypted: the server row has no readable statement data
  await saved(page);
  const aliceId = server.users.get('alice@example.com').id;
  const row = server.rows.get(aliceId);
  assert(row && row.ciphertext && row.iv && row.salt, 'workspace row should be saved');
  const decoded = Buffer.from(row.ciphertext, 'base64').toString('latin1');
  for (const word of ['AMAZON', 'Chase', 'MARRIOTT', '4821', 'transactions']) assert(!decoded.includes(word), `ciphertext leaks "${word}"`);

  // Reload: still signed in, must unlock with the password; a wrong one fails
  await page.reload();
  await page.waitForSelector('#auth-form[data-form="unlock"]');
  assert.strictEqual(await page.isVisible('#app'), false);
  await page.fill('#auth-form input[name="password"]', 'not-the-password');
  await page.click('#auth-form button[type="submit"]');
  await page.waitForSelector('.auth-msg.err');
  assert.match(await page.textContent('.auth-msg.err'), /Wrong password/);
  await page.fill('#auth-form input[name="password"]', 'alice-pass-123');
  await page.click('#auth-form button[type="submit"]');
  await appVisible(page);
  const n = await page.evaluate(() => FS.App.state.transactions.length);
  assert.strictEqual(n, st.transactions.length);
  assert.strictEqual(await page.evaluate(() => FS.App.state.transactions.find((t) => /MYSTERY/.test(t.description)).category), 'Shopping', 'manual change was saved');

  // Log out wipes the page
  await page.click('#btn-logout');
  await page.waitForSelector('#auth-form[data-form="signin"]');
  assert.strictEqual(await page.evaluate(() => FS.App.state.transactions.length), 0);
  assert.strictEqual(await page.isVisible('#app'), false);

  // A second person, in another browser, sees only their own (empty) workspace
  const bob = await newPage(browser);
  await signUp(bob, 'Bob', 'bob@example.com', 'bob-pass-4567');
  assert.strictEqual((await bob.textContent('#user-name')).trim(), '👤 Bob');
  assert.strictEqual(await bob.evaluate(() => FS.App.state.statements.length), 0, "Bob must not see Alice's statements");
  await bob.setInputFiles('input[data-input="statements"]', [S('capital_one_quicksilver_2026-10.csv')]);
  await bob.waitForFunction(() => FS.App.state.statements.length === 1, null, { timeout: 15000 });
  await saved(bob);
  // Bob's session cannot read Alice's row even if the page asked for it
  assert.strictEqual(await bob.evaluate(async () => { const r = await FS_TEST_BACKEND.loadWorkspace(); return r && r.ciphertext; }), server.rows.get(server.users.get('bob@example.com').id).ciphertext);

  // Alice signs in on the first browser: her 3 statements, not Bob's
  await signIn(page, 'alice@example.com', 'alice-pass-123');
  await appVisible(page);
  assert.strictEqual(await page.evaluate(() => FS.App.state.statements.length), 3);

  // Change display name + password; the old password then no longer works
  await page.click('#tabs button[data-tab="settings"]');
  await page.fill('#acct-name', 'Alice W.');
  await page.click('[data-act="save-name"]');
  await page.waitForFunction(() => document.querySelector('#user-name').textContent.includes('Alice W.'));
  await page.fill('#pw-current', 'alice-pass-123');
  await page.fill('#pw-new', 'alice-new-pass-9');
  await page.fill('#pw-new2', 'alice-new-pass-9');
  await page.click('[data-act="change-pw"]');
  await page.waitForFunction(() => /Password changed/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 });
  await page.click('#btn-logout');
  await page.waitForSelector('#auth-form[data-form="signin"]');
  await signIn(page, 'alice@example.com', 'alice-pass-123');
  await page.waitForSelector('.auth-msg.err');
  await signIn(page, 'alice@example.com', 'alice-new-pass-9');
  await appVisible(page);
  assert.strictEqual(await page.evaluate(() => FS.App.state.statements.length), 3, 'data readable with the new password');
  assert.strictEqual((await page.textContent('#user-name')).trim(), '👤 Alice W.');

  // Clear all data deletes only Alice's row
  await page.click('#btn-clear');
  await page.waitForFunction(() => FS.App.state.statements.length === 0);
  await page.waitForTimeout(100);
  assert(!server.rows.has(aliceId), "Alice's row should be deleted");
  assert(server.rows.has(server.users.get('bob@example.com').id), "Bob's row must be untouched");

  // Data from the old offline version is offered for upload on first sign-up
  const carol = await newPage(browser);
  const legacy = await page.evaluate(() => FS.Store.serialize(Object.assign(FS.Store.emptyState(), { statements: [{ id: 'st1', bank: 'Chase', last4: '1111', fileName: 'old.pdf' }], transactions: [{ id: 'tx1', statementId: 'st1', date: '2026-01-02', description: 'OLD COFFEE', amount: 4 }] })));
  await carol.evaluate((v) => { localStorage.setItem('finance-statement.workspace.v1', v); }, legacy);
  await carol.reload();
  await carol.waitForFunction(() => window.FS && FS.Auth && FS.Auth.mode === 'signin');
  await signUp(carol, 'Carol', 'carol@example.com', 'carol-pass-890');
  await carol.waitForFunction(() => FS.App.state.statements.length === 1);
  await saved(carol);
  assert.strictEqual(await carol.evaluate(() => localStorage.getItem('finance-statement.workspace.v1')), null, 'old local copy removed after upload');

  assert.deepStrictEqual(errors, [], 'page errors: ' + errors.join('\n'));
  assert.deepStrictEqual(requests, [], 'unexpected network requests: ' + requests.join(', '));
  assert.strictEqual(server.users.size, 3);
  await browser.close();
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
