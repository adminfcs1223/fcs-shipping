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
  const address = String(body.address || '').trim().slice(0, 240); /* optional, partial is fine */
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

  /* --- book the held pickup slot (if one was chosen) --- */
  let pickupSlot = null, slotRowId = null;
  if (body.slotId && /^[0-9a-f-]{36}$/i.test(String(body.slotId)) && supabaseConfigured()) {
    try {
      const rows = await sb(
        `pickup_slots?id=eq.${body.slotId}&status=in.(open,held)`,
        {
          method: 'PATCH',
          prefer: 'return=representation',
          body: { status: 'booked', booked_name: name, booked_phone: phone, booked_email: email },
        }
      );
      if (rows && rows[0]) {
        slotRowId = rows[0].id;
        const d = new Date(rows[0].slot_date + 'T12:00:00')
          .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        pickupSlot = `${d} · ${rows[0].slot_time}`;
      }
    } catch (e) {
      console.error('slot booking failed (quote continues):', e.message);
    }
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
          address: address || null,
          pickup_slot: pickupSlot,
          cargo: `${quote.cargoLabel} (${quote.cuft} cu ft)`,
          quantity: quote.quantity,
          destination: quote.destination,
          extras: quote.extraLabels.concat(quote.supplyLabels),
          total_cents: quote.totalCents,
          status: 'new',
        },
      });
      quoteId = rows && rows[0] && rows[0].id;
      if (quoteId && slotRowId) {
        try {
          await sb(`pickup_slots?id=eq.${slotRowId}`, { method: 'PATCH', body: { quote_id: quoteId } });
        } catch (e) { console.error('slot quote_id stamp failed:', e.message); }
      }
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
            `Name:    ${name}`,
            `Phone:   ${phone}`,
            `Email:   ${email}`,
            address ? `Address: ${address}` : `Address: (not given)`,
            pickupSlot ? `Pickup:  ${pickupSlot} (BOOKED — see the admin Calendar)` : `Pickup:  not scheduled`,
            ``,
            `Cargo:       ${quote.cargoLabel} (${quote.cuft} cu ft total)`,
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
