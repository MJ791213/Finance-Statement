"""Generate FICTIONAL sample statements and receipts for trying the app.

    python3 scripts/make_samples.py

Writes into samples/. All names, numbers and amounts are made up.
Requires: reportlab
"""
import csv
import os

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), '..', 'samples')
os.makedirs(OUT, exist_ok=True)


def pdf(path, header_lines, sections, footer_lines=(), columns=(50, 100, 470), balance=False):
    c = canvas.Canvas(path, pagesize=letter)
    c.setFont('Helvetica', 10)
    y = 750
    for line in header_lines:
        c.drawString(50, y, line)
        y -= 14
    y -= 10
    for title, rows in sections:
        c.setFont('Helvetica-Bold', 10)
        c.drawString(50, y, title)
        y -= 16
        c.setFont('Helvetica', 9)
        for row in rows:
            if y < 60:
                c.showPage()
                c.setFont('Helvetica', 9)
                y = 750
            c.drawString(columns[0], y, row[0])
            c.drawString(columns[1], y, row[1])
            c.drawRightString(columns[2] + 40, y, row[2])
            if balance and len(row) > 3:
                c.drawRightString(columns[2] + 110, y, row[3])
            y -= 13
        y -= 10
    for line in footer_lines:
        c.drawString(50, y, line)
        y -= 14
    c.save()


# 1. Credit card statement (home = Seattle, WA; trip to San Diego Oct 3-7)
pdf(os.path.join(OUT, 'Chase_Sapphire_Statement_2026-10.pdf'),
    ['CHASE SAPPHIRE PREFERRED', 'Sample Person', 'Account Number: XXXX XXXX XXXX 4821',
     'Opening/Closing Date 09/15/26 - 10/14/26', 'Payment Due Date: 11/08/26   Minimum Payment Due: $40.00',
     'Credit Limit: $15,000   Available Credit: $12,411.07'],
    [('PAYMENTS AND OTHER CREDITS', [
        ('09/25', 'Payment Thank You-Mobile', '-1,500.00'),
        ('10/09', 'AMAZON.COM RETURN SEATTLE WA', '-19.99'),
    ]),
     ('PURCHASE', [
        ('09/16', 'ALASKA AIR 0272345678901 SEATTLE WA', '312.40'),
        ('09/17', 'WHOLEFDS RVA 10123 SEATTLE WA', '86.42'),
        ('09/18', 'NETFLIX.COM LOS GATOS CA', '15.49'),
        ('09/19', 'TST* DICK\'S DRIVE-IN SEATTLE WA', '18.75'),
        ('09/20', 'OPENAI *CHATGPT SUBSCR SAN FRANCISCO CA', '20.00'),
        ('09/21', 'Amazon.com*NK3L09XY2 Amzn.com/bill WA', '57.31'),
        ('09/22', 'PLANET FITNESS 8005551234 NH', '24.99'),
        ('09/24', 'SPOTIFY USA 877-778-1161 NY', '11.99'),
        ('09/26', 'CLAUDE.AI SUBSCRIPTION SAN FRANCISCO CA', '20.00'),
        ('09/28', 'STARBUCKS STORE 04512 SEATTLE WA', '6.85'),
        ('10/01', 'TRADER JOE S #131 SEATTLE WA', '64.20'),
        ('10/03', 'SEA-TAC AIRPORT PARKING SEATTLE WA', '72.00'),
        ('10/03', 'TST* HODAD\'S SAN DIEGO CA', '38.60'),
        ('10/04', 'UBER *TRIP HELP.UBER.COM CA', '23.15'),
        ('10/04', 'PHIL\'S BBQ SAN DIEGO CA', '52.30'),
        ('10/05', 'SQ *BREAKFAST REPUBLIC SAN DIEGO CA', '41.10'),
        ('10/05', 'CVS/PHARMACY #08821 SAN DIEGO CA', '12.49'),
        ('10/06', 'BALBOA PARK GIFT SHOP SAN DIEGO CA', '27.00'),
        ('10/07', 'MARRIOTT MARQUIS SAN DIEGO CA', '948.22'),
        ('10/08', 'Amazon.com*AB12CD34E Amzn.com/bill WA', '43.17'),
        ('10/10', 'MCDONALD\'S F1234 SEATTLE WA', '9.87'),
        ('10/11', 'KAISER PERMANENTE SEATTLE WA', '30.00'),
        ('10/12', 'TARGET 00012345 SEATTLE WA', '45.66'),
        ('10/13', 'DISNEY PLUS 888-905-7888 CA', '13.99'),
        ('10/13', 'MYSTERY MERCHANT LLC SEATTLE WA', '15.00'),
    ])],
    ['Total fees charged in 2026 $0.00', 'Page 1 of 1'])

# 2. Checking statement with running balance column
pdf(os.path.join(OUT, 'BankOfAmerica_Checking_Statement_2026-10.pdf'),
    ['Bank of America', 'Your Adv Plus Banking', 'Account number: 0012 3456 7733',
     'for September 1, 2026 to September 30, 2026', 'Beginning balance on September 1, 2026 $4,210.55'],
    [('Deposits and other additions', [
        ('09/01/26', 'ACME CORP DES:PAYROLL ID:000123', '3,250.00', '7,460.55'),
        ('09/15/26', 'ACME CORP DES:PAYROLL ID:000123', '3,250.00', '7,912.81'),
    ]),
     ('Withdrawals and other subtractions', [
        ('09/02/26', 'SAFEWAY #1234 SEATTLE WA', '112.34', '7,348.21'),
        ('09/03/26', 'EQUINOX SEATTLE MEMBERSHIP', '215.00', '7,133.21'),
        ('09/05/26', 'CHASE CREDIT CRD DES:EPAY ID:XXXX4821', '1,500.00', '5,633.21'),
        ('09/08/26', 'COSTCO WHSE #0001 SEATTLE WA', '187.45', '5,445.76'),
        ('09/12/26', 'PUGET SOUND ENERGY DES:UTILITY', '84.20', '5,361.56'),
        ('09/14/26', 'Zelle payment to Landlord Conf# abc123', '2,700.00', '2,661.56'),
        ('09/20/26', 'PHO BAC SUP SHOP SEATTLE WA', '28.40', '7,884.41'),
    ])],
    ['Ending balance on September 30, 2026 $7,884.41'], balance=True)

# 3. Credit card CSV export with Debit/Credit columns and a card-number column
with open(os.path.join(OUT, 'capital_one_quicksilver_2026-10.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Transaction Date', 'Posted Date', 'Card No.', 'Description', 'Category', 'Debit', 'Credit'])
    w.writerows([
        ['2026-10-02', '2026-10-03', '9912', 'KROGER #612 SEATTLE WA', 'Grocery', '54.10', ''],
        ['2026-10-06', '2026-10-07', '9912', 'AMAZON MKTPL*ZZ99YY88 Amzn.com/bill WA', 'Merchandise', '36.36', ''],
        ['2026-10-09', '2026-10-10', '9912', 'MIDJOURNEY INC. SOUTH SAN FRAN CA', 'Other Services', '10.00', ''],
        ['2026-10-15', '2026-10-16', '9912', 'CAPITAL ONE AUTOPAY PYMT', 'Payment/Credit', '', '200.00'],
        ['2026-10-18', '2026-10-19', '9912', 'SHELL OIL 57444 SEATTLE WA', 'Gas/Automotive', '48.02', ''],
        ['2026-10-20', '2026-10-21', '9912', 'NEIGHBORHOOD NOODLE SEATTLE WA', 'Dining', '22.80', ''],
    ])

# 4. Amazon "Request your data" order history (two orders matching the Chase charges)
with open(os.path.join(OUT, 'amazon_Retail.OrderHistory.1.csv'), 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['Website', 'Order ID', 'Order Date', 'Currency', 'Unit Price', 'Quantity', 'Total Owed',
                'Order Status', 'Ship Date', 'Product Name', 'Payment Instrument Type'])
    w.writerows([
        ['Amazon.com', '111-1111111-1111111', '2026-09-19T18:22:10Z', 'USD', '18.99', '1', '20.70', 'Closed',
         '2026-09-20T09:00:00Z', 'Nature Made Vitamin D3 2000 IU Softgels, 250 Count', 'Visa - 4821'],
        ['Amazon.com', '111-1111111-1111111', '2026-09-19T18:22:10Z', 'USD', '14.49', '1', '15.79', 'Closed',
         '2026-09-20T09:00:00Z', 'Lavazza Super Crema Whole Bean Coffee Blend, 2.2 lb', 'Visa - 4821'],
        ['Amazon.com', '111-1111111-1111111', '2026-09-19T18:22:10Z', 'USD', '19.10', '1', '20.82', 'Closed',
         '2026-09-20T09:00:00Z', 'USB-C Charging Cable 6ft, 3-Pack', 'Visa - 4821'],
        ['Amazon.com', '222-2222222-2222222', '2026-10-06T12:01:00Z', 'USD', '39.60', '1', '43.17', 'Closed',
         '2026-10-07T15:00:00Z', 'Resistance Bands Set for Working Out', 'Visa - 4821'],
    ])

# 5. Amazon invoice printed to PDF (matches the Capital One Amazon charge)
c = canvas.Canvas(os.path.join(OUT, 'amazon_invoice_333-3333333.pdf'), pagesize=letter)
c.setFont('Helvetica', 10)
y = 750
for line in ['amazon.com', 'Final Details for Order #333-3333333-3333333', 'Order Placed: October 4, 2026',
             'Order Total: $36.36', '', 'Items Ordered                                   Price',
             '1 of: Advil Ibuprofen Tablets 200mg, 100 Count   $11.97',
             '1 of: Hydro Flask Wide Mouth Water Bottle 32 oz   $21.95', '',
             'Item(s) Subtotal: $33.92', 'Estimated tax to be collected: $2.44', 'Grand Total: $36.36', '',
             'Credit Card transactions   Visa ending in 9912: October 6, 2026: $36.36']:
    c.drawString(50, y, line)
    y -= 14
c.save()

print('Samples written to', os.path.abspath(OUT))
