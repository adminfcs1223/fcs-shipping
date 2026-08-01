# FCS Shipping — Full-Stack Website Build Brief

## Goal
Turn the included static preview (`fcs-shipping-preview.html`) into a fully functional,
deployable website for FCS Shipping LLC with a real backend. Keep the existing design
exactly as-is: white background, black text, deep ocean-blue (#1B4965) accent,
"FCS Shipping LLC." wordmark, existing copy and photos.

## Company facts (do not change)
- FCS Shipping LLC, 9502 Ditmas Ave Building 4, Brooklyn NY 11236
- Phones: (718) 483-8006, (646) 606-8320 · Email: admin@fcsshipping.com
- Hours: Mon–Fri 9am–5pm
- Routes: Brooklyn → St. Lucia (Port Castries, Vieux-Fort, Cul-de-Sac) + other Caribbean islands
- Slogans: "Make Ship Happen!", "You name it, we ship it!", "Professional, Reliable, Rapid Service!"
- Founder: Felix Harrison

## Build phases (in order)

### Phase 1 — Project scaffold
- Restructure the single HTML file into a small static-site project (keep vanilla
  HTML/CSS/JS or use Astro/Eleventy — no heavy framework needed).
- Pull ALL editable values into one config file (`site.config.json`): prices, port fees,
  extras, sailing schedule, contact info, FAQ items, hero text.
- Download the two Squarespace CDN photos into the repo (/assets) so the site does not
  depend on the old site staying online.
- Git repo ready to push to GitHub; deploy target: Netlify (include netlify.toml).

### Phase 2 — Quote requests (working form)
- "Lock in this rate" turns the live waybill into a quote-request form:
  name, phone, email + the selected cargo/destination/extras/total.
- Submissions go to a Netlify serverless function that emails admin@fcsshipping.com
  (use Resend or SMTP; leave the API key as an env var placeholder) AND stores the
  request in the database (Phase 4 table `quote_requests`).
- Spam protection (honeypot + basic rate limit).

### Phase 3 — Payments (Stripe)
- Stripe Checkout via a serverless function that charges the exact calculated quote
  total as a deposit. Env var placeholders for STRIPE_SECRET_KEY / webhook secret.
- Webhook marks the related quote_request as "deposit paid".
- Keep a clearly-labeled TEST MODE until real keys are added.

### Phase 4 — Real tracking backend (Supabase free tier)
- Tables: `shipments` (waybill_no, customer name/phone, cargo, destination, status,
  vessel, eta), `shipment_events` (shipment_id, status, note, timestamp),
  `quote_requests`, `sailings` (vessel, departs, arrives, cutoff, status).
- Public tracking page queries by waybill number (read-only, RLS-protected).
- Sailing schedule section reads live from `sailings` table with fallback to config.

### Phase 5 — Staff admin dashboard
- Simple password-protected /admin page (Supabase Auth, email login for staff):
  - Create shipment (order entry) → auto-generates waybill number FCS-YYYY-XXXX
  - Order entry includes a "Tracking Number" text box (placeholder: "Insert eBL")
    for the carrier's electronic Bill of Lading / booking number, stored as
    `ebl_no` on the shipment record
  - Every order confirmation (on-screen receipt + any email/SMS to the customer)
    ends with the line: "You can track your shipment at fcsshipping.com"
  - Customers can look up their shipment on the public tracking page by EITHER
    the FCS waybill number or the eBL tracking number
  - Update shipment status (received → loaded → at sea → arrived → ready) with one tap
  - Manage sailings (add/edit dates, mark closed/sailed)
  - View quote requests and mark handled
  - Edit prices/fees (writes to a `settings` table)
- Mobile-friendly — staff will use phones in the warehouse.

### Phase 6 — Deploy & handoff
- Push to GitHub, connect Netlify, set env vars, deploy.
- Write a plain-English OWNERS-GUIDE.md: how to update the schedule, change prices,
  update a shipment status, see quote requests, connect fcsshipping.com domain,
  and where the Stripe/Supabase/Resend keys go.

## Accounts the owner must create (pause and ask when needed)
GitHub, Netlify, Supabase, Stripe, Resend (or other email provider).

## Guardrails
- Demo prices in the preview are placeholders — keep them but flag clearly where the
  owner sets real rates.
- No customer PII in the public client; all writes go through serverless functions.
- Keep everything on free tiers until told otherwise.
