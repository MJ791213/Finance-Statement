# Statement Categorizer

Drop in your monthly bank and credit card statements and get:

1. **Bank name and the last 4 digits** of each account, detected automatically.
2. **Spending by category**, with a tab for each category: Grocery, Restaurant/Eat Out, Fitness Club, Entertainment Sub, Travel (Hotel & Trans), AI Tool Sub, Shopping, Medical, plus Gas & Auto, Bills & Utilities and Other. You can rename, add or delete categories.
3. **Receipt matching.** Upload your Amazon order history or receipt PDFs. Each receipt is matched to its card charge, and the charge is split by item. For example, one Amazon order becomes Medical $20.70, Grocery $15.79 and Shopping $20.82.
4. **Trip awareness.** Restaurant and eat-out spending during a trip is counted as **Travel**. Trips are detected automatically from hotel and car rental charges and from in-person purchases outside your home state. You can also add trips by hand.

Everything is shown in your browser, and **Export Excel** creates a workbook with tabs for Accounts, Summary, Transactions, each category, Trips and Receipts.

## Privacy and safety

- **No server, no upload, no account.** It is a plain web page you open from your own disk. PDFs are read inside the browser tab with a bundled copy of pdf.js.
- **Network access is blocked.** The page's Content-Security-Policy sets `connect-src 'none'`, so the browser refuses any network request from the page. You can also turn off Wi-Fi while you use it.
- **Your data is saved only in this browser** (localStorage), so you don't have to re-import each time. **Clear all data** removes it. **Backup** and **Restore** save and load a JSON file that you control.
- **Your financial files are never committed to git.** `.gitignore` excludes `*.pdf`, `*.csv`, `*.xlsx`, backups and the folders `private/`, `statements/`, `receipts/` and `my-data/`. Only the fictional files in `samples/` are tracked. Keep your real files in `private/` or outside the repo.
- Keep this repository **private** on GitHub anyway.

## How to use

1. Download or clone this repo, then double-click **`index.html`**. It works in Chrome, Edge, Firefox and Safari. Nothing needs to be installed.
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
index.html          UI shell (strict CSP)
js/util.js          dates, amounts, CSV parser
js/categories.js    default categories + keyword rules
js/statement.js     PDF-text/CSV → transactions; bank, last-4, period detection
js/pdftext.js       pdf.js text extraction (in-page, no worker)
js/receipts.js      Amazon CSV / receipt parsing + matching to transactions
js/trips.js         trip detection
js/engine.js        categorization pipeline and summaries
js/export.js        Excel workbook (SheetJS)
js/app.js           UI
vendor/             pdf.js 3.11.174, SheetJS 0.18.5 (Apache-2.0)
samples/            FICTIONAL statements/receipts (python3 scripts/make_samples.py)
tests/e2e.test.js   headless-Chromium end-to-end test (needs Playwright)
```

Run the tests with `npm test`. This needs Playwright and Chromium installed.
