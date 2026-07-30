# FCS Shipping — System Overview

*The master map of everything built, how it connects, and where to control it.*
*Last updated: July 29, 2026*

---

## 1. The live URLs

| What | Where | Who uses it |
|---|---|---|
| Public website | **https://fcsshipping.com** | Customers |
| Customer portal | https://fcsshipping.com/account/ | Customers (self-signup) |
| Staff dashboard | https://fcsshipping.com/admin/ | Staff only |
| Order entry & invoicing | https://fcsshipping.com/admin/orders/ | Staff only |
| Terms of service | https://fcsshipping.com/legal/terms/ | Public |
| Privacy policy | https://fcsshipping.com/legal/privacy/ | Public |

The old `fcsshippingllc.netlify.app` address still works and points to the same site.

---

## 2. The accounts that power it

| Service | Purpose | Login |
|---|---|---|
| **GitHub** (adminfcs1223/fcs-shipping) | Stores the website code. Every commit auto-deploys. | github.com |
| **Netlify** (project: fcsshippingllc) | Hosts the site + runs the 11 serverless functions. Holds all secret keys as environment variables. | app.netlify.com |
| **Supabase** (project tgjrqmapaqrrdgpjssjl) | The database: shipments, EB/Ls, quotes, sailings, customers, orders, settings, staff logins, customer logins. | supabase.com |
| **Stripe** (FCS Shipping sandbox) | Card payments for EB/Ls and deposits. **Still in TEST mode** — see §8. | dashboard.stripe.com |
| **Resend** | Sends quote-request emails to admin@fcsshipping.com. | resend.com |
| **Intuit / QuickBooks** (app: FCS Admin, production) | Bookkeeping — invoices post automatically from order entry. Connected to the real FCS Shipping LLC company. | developer.intuit.com |
| **Domain** | fcsshipping.com, pointed at Netlify with automatic HTTPS. | your registrar |

**Staff account:** admin@fcsshipping.com (the only user on the `staff` list; add more via Supabase → Authentication → Users, then the insert line at the bottom of `supabase/customer-portal.sql`).

---

## 3. What customers can do (public site)

- **Get a live quote** — cargo priced by cubic foot × destination rate:
  Barrel (15 cu ft) · Commercial Bin (20 cu ft) · Box (enters L×W×H, auto-converts to cu ft) · Other (EB/L number)
  Destinations: Vieux-Fort $11/cu ft · Cul-de-Sac $10/cu ft · Other → call
  Extras: Brooklyn pickup FREE · other borough +$20 · insurance +$25
  Supplies: cardboard barrel $45 · plastic barrel $65 · commercial bin $65, each with quantity, +$5 home delivery
- **Lock in a quote** — sends the office an email and saves it to the database
- **Pay online** — a quote deposit, or the exact amount on a staff-issued **EB/L number** ("Pay now", no estimate language)
- **Track cargo** by B/L number — live timeline from warehouse to island
- **Create a free account** — see their own shipments and quotes, auto-matched by email
- See: 5-star testimonials, St. Lucia House Foundation endorsement (hero) and Business Award (about section), every-Thursday departure date, Caribbean-islands ticker, sailing schedule

## 4. What staff can do

**/admin (dashboard)** — six tabs:
- **Shipments**: search, create (auto B/L number `FCS-2026-XXXX`), one-tap status advance (received → loaded → at sea → arrived → ready) — each change is instantly visible to the customer tracking it
- **New**: create shipment; entering the customer's email makes it appear in their portal
- **EB/L**: generate a pre-priced electronic bill of lading (`EBL-2026-XXXX`) the customer can pay online; void if needed
- **Quotes**: see website quote requests (green badge when deposit paid), mark handled
- **Sailings**: add departures, cycle open → closing → closed → sailed
- **Prices**: edit EVERY product name, cubic footage, destination rate, extra, supply price, delivery fee, plus the customer **testimonials** — changes go live on the site immediately

**/admin/orders (order entry)** — the paper form, digitized:
- Fill the form on the left, pixel-perfect printable replica on the right (Print / save PDF)
- Customers on file pre-fill shipper + consignee; invoice numbers auto-advance
- **Billing panel**: one button creates an **EB/L + QuickBooks invoice** together; big **PAID / NOT PAID** toggle; "Copy EB/L for customer" puts a ready-to-text message on the clipboard
- Orders list shows EB/L number, QuickBooks invoice number, and paid status
- Settings: company block on the printed form, invoice numbering, QuickBooks connect/reconnect, JSON backup/restore, CSV export

---

## 5. How everything connects (the flows)

```
CUSTOMER QUOTE
  site quote builder ──▶ quote-request function ──▶ Supabase (quote_requests)
                                   └──▶ Resend email to admin@fcsshipping.com
  "Pay deposit" ──▶ create-checkout ──▶ Stripe ──▶ webhook marks quote deposit_paid

WALK-IN / PHONE ORDER
  order entry (staff) ──▶ save order (Supabase settings store)
        └─ "Create EB/L + QuickBooks invoice"
              ├──▶ ebl table (EBL-2026-XXXX, exact price)
              └──▶ QuickBooks invoice (customer auto-created/matched)
  customer enters EB/L on website ──▶ exact price loads ──▶ Pay now ──▶ Stripe
        └──▶ webhook marks EB/L paid
  staff "Mark PAID" (cash/Zelle) ──▶ EB/L paid + payment recorded in QuickBooks

CARGO TRACKING
  staff advances status in /admin ──▶ shipments + shipment_events tables
        └──▶ customer sees it at /#track and in their portal (matched by email)

PRICING & CONTENT
  admin Prices tab ──▶ settings table ──▶ website quotes + server-side totals
  (site.config.json in GitHub is the fallback + text/FAQ/hero editor)
```

**Money rule:** prices are always recomputed **server-side** — nothing a customer types in the browser can change what they're charged.

---

## 6. The database (Supabase tables)

| Table | Holds | Who can touch it |
|---|---|---|
| `shipments` / `shipment_events` | Cargo + tracking timeline | Staff: all. Customers: read their own (email match). Public tracking via function, no PII exposed. |
| `ebl` | Electronic bills of lading, price, paid status, QuickBooks invoice ids | Staff only; public lookup via function returns price/cargo only |
| `quote_requests` | Website quotes, deposit status | Staff all; customers read their own |
| `sailings` | Departure schedule | Public read; staff write |
| `settings` | Prices, testimonials, order-entry records (`fcs:*` keys), QuickBooks tokens | Staff + serverless only |
| `staff` | Who counts as staff (`is_staff()` gate) | The linchpin of all security |

## 7. Security model (the short version)

- Customers self-register but Row-Level Security limits them to **their own rows**; staff powers require being on the `staff` table
- All secret keys (Stripe, Supabase service role, Resend, QuickBooks) live **only in Netlify env vars** — never in code or the browser (enforced by Netlify secrets scanning, which already caught one real leak that was rotated)
- QuickBooks OAuth: CSRF-protected (single-use random state), tokens stored server-side, `intuit_tid` logged on every call for supportability
- Payments: Stripe hosts the card form; card numbers never touch FCS systems

## 8. Environment variables (Netlify → Environment variables)

`SUPABASE_URL` · `SUPABASE_SERVICE_ROLE_KEY` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `RESEND_API_KEY` · `QUOTE_EMAIL_FROM` · `QUOTE_EMAIL_TO` · `QB_CLIENT_ID` · `QB_CLIENT_SECRET` · `QB_ENV` (=production) · `SECRETS_SCAN_OMIT_KEYS`

After changing any of them: Deploys → Trigger deploy.

## 9. Open items / next steps

1. **Stripe is still in TEST mode** — customers "paying" an EB/L today are not really charged (card 4242… works). To go live: activate the real Stripe account, swap `STRIPE_SECRET_KEY` to `sk_live_…`, create a live-mode webhook to `https://fcsshipping.com/.netlify/functions/stripe-webhook`, update `STRIPE_WEBHOOK_SECRET`, set `"testMode": false` in site.config.json.
2. **QuickBooks $1 test** — bill one small test order, confirm the invoice and payment in QuickBooks, then delete them there.
3. **Resend domain** — verify fcsshipping.com in Resend and change `QUOTE_EMAIL_FROM` so quote emails come from @fcsshipping.com.
4. **Update the Stripe webhook** in the sandbox → live migration to the fcsshipping.com URL (current one uses the netlify.app address — still works, but tidy it when going live).
5. Optional hardening: staff MFA; lawyer pass over the legal pages; ES/FR language versions (selector is already in the nav); the multi-theme LATAM/Europe landing-page plan.

## 10. Where to change things — cheat sheet

| I want to… | Go to… |
|---|---|
| Change a price, product name, or cu ft | /admin → Prices |
| Add/edit testimonials | /admin → Prices (bottom card) |
| Update the sailing schedule | /admin → Sailings |
| Move a shipment's status | /admin → Shipments |
| Bill an order (EB/L + QuickBooks) | /admin/orders → Billing panel |
| Mark something paid | /admin/orders (or /admin → EB/L) |
| Change hero text, FAQ, contact info | `site.config.json` in GitHub (edit → commit; live in ~1 min) |
| Add a staff member | Supabase → Auth → Add user, then staff insert (see customer-portal.sql) |
| Rotate/replace any key | Netlify → Environment variables → trigger deploy |
