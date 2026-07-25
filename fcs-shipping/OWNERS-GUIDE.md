# FCS Shipping Website — Owner's Guide

Written for the FCS team, no tech background needed. Keep this file handy.

## The 5 free accounts you need (create in this order)

1. **GitHub** (github.com) — stores the website's code.
2. **Netlify** (netlify.com) — puts the website on the internet. Sign up "with GitHub".
3. **Supabase** (supabase.com) — the database: shipments, tracking, sailings, quote requests.
4. **Resend** (resend.com) — sends quote-request emails to admin@fcsshipping.com.
5. **Stripe** (stripe.com) — takes card deposits online.

Everything runs on free plans. Stripe only takes a % of actual card payments.

## One-time setup (about an hour, or ask any tech-comfortable helper)

1. **GitHub**: create a repository called `fcs-shipping` and upload this folder (or ask your helper to `git push` it).
2. **Netlify**: "Add new site → Import from GitHub" → pick `fcs-shipping` → Deploy. Your site is now live at something like `fcs-shipping.netlify.app`.
3. **Supabase**: create a project. Then:
   - **SQL Editor → New query** → paste everything from the file `supabase/schema.sql` → **Run**. This creates all tables plus a demo shipment.
   - **Authentication → Users → Add user** → create a login (email + password) for each staff member.
   - **Project Settings → API** → copy the **Project URL** and the **anon public** key into the file `admin/config.js` (two clearly-marked lines), and give the **service_role** key to Netlify (next step). The service_role key is secret — only ever paste it into Netlify.
4. **Netlify environment variables** (Site settings → Environment variables): add each name from `.env.example` with your real values — `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `QUOTE_EMAIL_FROM`, `QUOTE_EMAIL_TO`. Then "Trigger deploy".
5. **Resend**: create an API key → paste into Netlify as `RESEND_API_KEY`. Later, verify the domain fcsshipping.com in Resend and change `QUOTE_EMAIL_FROM` to `FCS Shipping <quotes@fcsshipping.com>`.
6. **Stripe**: copy the **test** secret key (starts `sk_test_`) into Netlify as `STRIPE_SECRET_KEY`. In Stripe → Developers → Webhooks, add endpoint `https://YOUR-SITE.netlify.app/.netlify/functions/stripe-webhook` for the event `checkout.session.completed`, and copy its signing secret (starts `whsec_`) into Netlify as `STRIPE_WEBHOOK_SECRET`. The site shows a yellow **TEST MODE** badge until you swap in the live key (`sk_live_`) and set `"testMode": false` in `site.config.json`.
7. **Photos**: run `bash scripts/fetch-assets.sh` once (your helper can), so the two photos live in the repo instead of the old Squarespace site.

## Everyday tasks (all from a phone)

**Update a shipment status** — go to `yoursite.com/admin`, log in, find the shipment (search by waybill, name, or phone), tap **Mark Loaded / At sea / Arrived / Ready**. Customers see the change on the tracking page immediately.

**Create a new shipment** — admin → **New** tab → enter customer, cargo, destination → tap create. The waybill number (like FCS-2026-1007) appears big on screen; write it on the cargo and give it to the customer.

**Update the sailing schedule** — admin → **Sailings** tab. Add a departure (arrival and cut-off dates fill in automatically, editable), and tap the status button as it moves from open → closing → closed → sailed.

**Change prices or fees** — admin → **Prices** tab → edit the numbers → **Save prices**. The website quotes the new rates immediately. ⚠️ The prices shipped with this site are DEMO prices — set your real rates before telling customers about the site.

**See quote requests** — they arrive two ways: an email to admin@fcsshipping.com, and in admin → **Quotes** (green "deposit paid" badge if they paid by card). Tap **Mark handled** once you've called them.

**Change wording, FAQ, hours, or hero text** — edit `site.config.json` in GitHub (open the file → pencil icon → edit → "Commit changes"). Netlify republishes automatically in about a minute.

## Connect the fcsshipping.com domain

In Netlify: Domain settings → Add custom domain → `fcsshipping.com` → follow the DNS instructions shown (at your domain registrar, point the domain to Netlify). HTTPS is automatic and free.

## If something breaks

The site is built to degrade politely: if the database or email is down, customers see "call us at (718) 483-8006" instead of errors. Quote emails failing? Check `RESEND_API_KEY` in Netlify. Tracking down? Check the two Supabase values. Payments? Check the two Stripe values. After changing any variable, "Trigger deploy" in Netlify.

## Where the keys live (summary)

Secret keys (Supabase service_role, Stripe secret, Resend) → **only** in Netlify environment variables. Public values (Supabase URL + anon key) → `admin/config.js` in the repo. Nothing secret is ever in the code or on GitHub.
