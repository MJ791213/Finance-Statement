# Statement Categorizer

Drop in your monthly bank and credit card statements and get:

1. **Bank name and the last 4 digits** of each account, detected automatically.
2. **Spending by category**, with a tab for each category: Grocery, Restaurant/Eat Out, Fitness Club, Entertainment Sub, Travel (Hotel & Trans), AI Tool Sub, Shopping, Medical, plus Gas & Auto, Bills & Utilities and Other. You can rename, add or delete categories.
3. **Receipt matching.** Upload your Amazon order history or receipt PDFs. Each receipt is matched to its card charge, and the charge is split by item. For example, one Amazon order becomes Medical $20.70, Grocery $15.79 and Shopping $20.82.
4. **Trip awareness.** Restaurant and eat-out spending during a trip is counted as **Travel**. Trips are detected automatically from hotel and car rental charges and from in-person purchases outside your home state. You can also add trips by hand.

Everything is shown in your browser, and **Export Excel** creates a workbook with tabs for Accounts, Summary, Transactions, each category, Trips and Receipts.

## Accounts and online saving

Each person signs in with their **own account** (email + password) and picks a **name**, which is shown at the top of the page. Your workspace (statements, transactions, receipts, trips, rules and categories) is **saved online automatically**, so you can sign in from any computer and pick up where you left off. The top bar shows *Saving… / Saved ✓*.

**Each person can only see their own statements.** This is enforced twice:

1. **By the database.** Every account has exactly one row in the `workspaces` table. Supabase *row-level security* (`supabase/schema.sql`) makes the database refuse to return, change or delete any row that is not the signed-in user's, whatever a web page asks for.
2. **By encryption.** Before anything is uploaded, the page encrypts your workspace in the browser with AES-256-GCM. The key is derived from your password (PBKDF2-SHA256, 600,000 rounds). The server only ever stores unreadable ciphertext, so even the database owner cannot read your statements.

Things to know:

- **There is no password reset.** Your data is encrypted with your password, so if you forget it, nobody can recover the saved data. Use a password manager, and use **Backup** now and then.
- You can change your display name and password under **Rules & Settings → My account**. Changing the password re-encrypts your workspace.
- After a page reload you stay signed in, but you type your password once more to **unlock** (decrypt) the workspace. **Log out** removes everything from the page.
- **Clear all data** deletes your online workspace. Your account stays.
- If you used the older offline version in the same browser, the app offers to upload that data to your new account the first time you create one.

## Privacy and safety

- **Statements are read inside your browser.** PDFs are parsed in the tab with a bundled copy of pdf.js. The original files are never uploaded; only the encrypted workspace is.
- **Network access is locked down.** The page's Content-Security-Policy allows network requests **only** to Supabase (`https://*.supabase.co`), and all scripts are bundled in this repo (no CDNs).
- **Backup** and **Restore** save and load an unencrypted JSON file that you control. Keep it somewhere safe.
- **Your financial files are never committed to git.** `.gitignore` excludes `*.pdf`, `*.csv`, `*.xlsx`, backups and the folders `private/`, `statements/`, `receipts/` and `my-data/`. Only the fictional files in `samples/` are tracked.

## Setup (once, about 10 minutes)

1. **Create a Supabase project:** sign up at [supabase.com](https://supabase.com) (the free plan is enough) → *New project*.
2. **Create the table:** in the project open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
3. **Connect the page:** open **Project Settings → API** and copy the *Project URL* and the *anon public* key (newer projects call it the *publishable* key, `sb_publishable_…`) into [`js/config.js`](js/config.js). Both are meant to be public; row-level security protects the data.
4. **Email settings:** under **Authentication → Sign In / Providers → Email**, *Confirm email* is on by default. New users then get a link to click before they can sign in. Under **Authentication → URL Configuration**, set the *Site URL* to the address where you host the page (step 5), so the link leads back to it.
5. **Host the page:** the easiest way is GitHub Pages. In the repo, go to **Settings → Pages → Deploy from a branch**, pick your branch and `/ (root)`, and you get a URL like `https://<you>.github.io/Finance-Statement/`. Any static host works. Opening `index.html` straight from disk also works, but email confirmation links need a hosted Site URL.

## How to use

1. Open the hosted page (or `index.html`) and **Create account**, or **Sign in**. It works in Chrome, Edge, Firefox and Safari.
2. **Import tab → Bank statements.** Drop one or more statement PDFs or CSV downloads, from any bank, months or accounts.
3. **Import tab → Receipts** (optional):
   - **Amazon:** go to Amazon → Account → *Request Your Data* → *Your Orders*, then drop `Retail.OrderHistory.1.csv`. You can also drop an order invoice that you printed to PDF.
   - **Other stores:** drop receipt PDFs. A receipt is matched to a charge with the same amount within a few days.
4. Review the results:
   - **Accounts:** the detected bank and last 4 digits, which you can edit. If purchases show up as credits, use **Flip ±**.
   - **Summary:** totals per category, plus a month-by-month table. Use the Account and Month filters at the top.
   - **Categories:** one tab per category, listing its transactions.
   - **Transactions:** change any category from its drop-down. **Always…** creates a rule, so the merchant is categorized that way on every statement.
   - **Trips:** set your home state, confirm (**Keep & edit**) or dismiss detected trips, or add a trip with start and end dates.
   - **Receipts:** see how each item was categorized and change an item's category. You can also link a receipt to a transaction by hand.
   - **Rules & Settings:** manage categories, your keyword rules, the built-in keywords, and which categories become Travel during a trip.
5. **Export Excel** downloads the workbook for the current filter.

### How a category is chosen (highest priority first)

1. A category you picked by hand.
2. The items on a matched receipt. If the items fall into different categories, the charge is split in proportion, with tax and shipping spread across the items.
3. Your own keyword rules, then the built-in keywords. When several keywords match, the longest one wins, so "UBER EATS" beats "UBER".
4. The category column in the bank's CSV, if there is one.
5. Otherwise, Other.

After that, any spending in the categories selected under Rules & Settings → *During a trip* (Restaurant/Eat Out by default) that falls inside a trip is moved to **Travel (Hotel & Trans)**.

### Supported statements

- **PDF:** text-based statements from most US banks and card issuers. These include Chase, Bank of America, Wells Fargo, Citi, Capital One, Amex, Discover, U.S. Bank and about 25 others recognized by name. Unknown banks still work, but you need to type the bank name on the Accounts tab.
- **CSV:** any export with a Date column, a Description column, and either an Amount column or Debit/Credit columns.
- **Scanned (image) PDFs** have no text to read. Download the CSV version from your bank instead.

Statement layouts vary a lot. If a statement imports wrongly (missing rows, wrong signs), please open an issue with a description of the layout. Don't attach the real statement.

## For developers

```
index.html          UI shell (strict CSP: network only to *.supabase.co)
js/config.js        your Supabase project URL + anon key
js/auth.js          sign in / create account / unlock screens
js/backend.js       Supabase calls (auth + the user's workspace row)
js/crypto.js        WebCrypto: PBKDF2 key derivation, AES-GCM encrypt/decrypt
js/store.js         encrypt + save online (debounced), load + decrypt
supabase/schema.sql table + row-level security policies
js/util.js          dates, amounts, CSV parser
js/categories.js    default categories + keyword rules
js/statement.js     PDF-text/CSV → transactions; bank, last-4, period detection
js/pdftext.js       pdf.js text extraction (in-page, no worker)
js/receipts.js      Amazon CSV / receipt parsing + matching to transactions
js/trips.js         trip detection
js/engine.js        categorization pipeline and summaries
js/export.js        Excel workbook (SheetJS)
js/app.js           UI
vendor/             pdf.js 3.11.174, SheetJS 0.18.5 (Apache-2.0), supabase-js 2.119.0 (MIT)
samples/            FICTIONAL statements/receipts (python3 scripts/make_samples.py)
tests/e2e.test.js   headless-Chromium end-to-end test (needs Playwright); uses a fake
                    in-process server instead of Supabase, and checks that accounts
                    can't see each other's data and that saved data is encrypted
```

Run the tests with `npm test`. This needs Playwright and Chromium installed.
