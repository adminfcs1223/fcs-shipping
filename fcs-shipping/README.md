# FCS Shipping — Website

Static site (vanilla HTML/CSS/JS) + Netlify serverless functions + Supabase (free tier).
Plain-English instructions for the owner are in **OWNERS-GUIDE.md**.

## Structure

```
index.html              Public site (design unchanged from approved preview)
admin/                  Staff dashboard (Supabase Auth login)
site.config.json        ALL editable content: prices, schedule, contact, FAQ, hero text
css/ js/ assets/        Styles, front-end logic, photos
netlify/functions/      quote-request, create-checkout, stripe-webhook, track, sailings, pricing
supabase/schema.sql     Tables + RLS + waybill generator + seed data (run once in Supabase)
scripts/fetch-assets.sh One-time photo download from the old Squarespace CDN
netlify.toml            Netlify build/headers config
.env.example            Environment variable placeholders (copy values into Netlify)
```

## Local dev

```
bash scripts/fetch-assets.sh   # one time: vendor the photos
npm install
npm run dev                    # netlify dev → http://localhost:8888 (functions work)
# or: npm run serve            # static only, functions gracefully fall back to demo data
```

## Deploy

1. Push to GitHub, import the repo in Netlify.
2. Run `supabase/schema.sql` in the Supabase SQL editor; add staff users under Authentication.
3. Set env vars from `.env.example` in Netlify; put the Supabase URL + anon key in `admin/config.js`.
4. Add the Stripe webhook endpoint `<site>/.netlify/functions/stripe-webhook` (event: `checkout.session.completed`).

Everything degrades gracefully: with no keys configured, the site still works with
config-file schedule, demo tracking (FCS-2026-4471), and quote requests that
return totals but tell users to call. **Demo prices are placeholders** — real
rates go in `site.config.json` (or the admin → Prices tab once Supabase is live).
