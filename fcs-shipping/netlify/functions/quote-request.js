/* Phase 2 — quote request: stores in Supabase + emails admin via Resend.
   Works in degraded mode (returns quote total) before either service is configured. */

const { config, getPricing, computeQuote, supabaseConfigured, sb, json, rateLimited } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  /* --- spam protection --- */
  if (body.website) return json(200, { ok: true, total: 0 }); // honeypot: pretend success
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (rateLimited(ip)) return json(429, { error: 'Too many requests — please call us instead.' });

  /* --- validate --- */
  const name = String(body.name || '').trim().slice(0, 120);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const email = String(body.email || '').trim().slice(0, 160);
  if (!name || !phone || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: 'Please provide a valid name, phone, and email.' });
  }

  /* --- price is computed HERE, never trusted from the client --- */
  let quote;
  try {
    quote = computeQuote(body, await getPricing());
  } catch (e) {
    return json(400, { error: e.message });
  }

  /* --- store in Supabase (Phase 4 table quote_requests) --- */
  let quoteId = null;
  if (supabaseConfigured()) {
    try {
      const rows = await sb('quote_requests', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          name,
          phone,
          email,
          cargo: `${quote.cargoLabel} (${quote.cuft * quote.quantity} cu ft)`,
          quantity: quote.quantity,
          destination: quote.destination,
          extras: quote.extraLabels.concat(quote.supplyLabels),
          total_cents: quote.totalCents,
          status: 'new',
        },
      });
      quoteId = rows && rows[0] && rows[0].id;
    } catch (e) {
      console.error('Supabase insert failed:', e.message);
    }
  }

  /* --- email the office via Resend --- */
  if (process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('PLACEHOLDER')) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.QUOTE_EMAIL_FROM || 'FCS Website <onboarding@resend.dev>',
          to: [process.env.QUOTE_EMAIL_TO || config.company.email],
          reply_to: email,
          subject: `New quote request — ${quote.summary} — $${(quote.totalCents / 100).toFixed(2)}`,
          text: [
            `New quote request from the website:`,
            ``,
            `Name:  ${name}`,
            `Phone: ${phone}`,
            `Email: ${email}`,
            ``,
            `Cargo:       ${quote.cargoLabel} × ${quote.quantity} (${quote.cuft * quote.quantity} cu ft @ $${quote.rate}/cu ft)`,
            `Destination: ${quote.destination}, St. Lucia`,
            `Extras:      ${quote.extraLabels.join(', ') || 'none'}`,
            `Supplies:    ${quote.supplyLabels.join(', ') || 'none'}`,
            `Estimated total: $${(quote.totalCents / 100).toFixed(2)}`,
            ``,
            quoteId ? `Ref: ${quoteId} (see the admin dashboard → Quotes)` : `(Not saved to database — Supabase not configured yet.)`,
          ].join('\n'),
        }),
      });
      if (!res.ok) console.error('Resend error:', res.status, await res.text());
    } catch (e) {
      console.error('Resend failed:', e.message);
    }
  } else {
    console.log('RESEND_API_KEY not set — quote request email skipped.');
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  const testMode = !stripeKey || stripeKey.includes('PLACEHOLDER') || stripeKey.startsWith('sk_test');

  return json(200, { ok: true, quoteId, total: quote.totalCents, testMode });
};
