/* Phase 3 — Stripe Checkout: charges the calculated quote total as a deposit.
   The amount is recomputed server-side from site.config.json; the client can't set prices. */

const { getPricing, computeQuote, json, rateLimited } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const key = process.env.STRIPE_SECRET_KEY || '';
  if (!key || key.includes('PLACEHOLDER')) {
    return json(503, { error: 'Online payments are not configured yet. Please call us to pay your deposit.' });
  }

  const ip = event.headers['x-nf-client-connection-ip'] || 'unknown';
  if (rateLimited(ip, 10)) return json(429, { error: 'Too many requests.' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const stripe = require('stripe')(key);
  const siteUrl = process.env.URL || 'http://localhost:8888';
  const testMode = key.startsWith('sk_test');

  let amountCents, productName, metadata;

  if (body.eblNo) {
    /* ---- EB/L: exact price on file, full payment ---- */
    const { supabaseConfigured, sb } = require('./utils/shared');
    if (!supabaseConfigured()) return json(503, { error: 'EB/L payments not available yet' });
    const no = String(body.eblNo).trim().toUpperCase();
    if (!/^EBL-\d{4}-\d{3,6}$/.test(no)) return json(400, { error: 'Invalid EB/L number' });
    let rows;
    try {
      rows = await sb(`ebl?ebl_no=eq.${encodeURIComponent(no)}&select=ebl_no,cargo,quantity,price_cents,status`);
    } catch (e) {
      console.error('ebl lookup error:', e.message);
      return json(502, { error: 'Lookup temporarily unavailable' });
    }
    if (!rows || !rows.length || rows[0].status === 'void') return json(404, { error: 'EB/L not found' });
    if (rows[0].status === 'paid') return json(400, { error: 'This EB/L is already paid.' });
    amountCents = rows[0].price_cents;
    productName = `EB/L ${rows[0].ebl_no} — ${rows[0].cargo}`;
    metadata = { ebl_no: rows[0].ebl_no, total_cents: String(amountCents) };
  } else {
    /* ---- regular quote: recompute server-side, charge as deposit ---- */
    let quote;
    try {
      quote = computeQuote(body, await getPricing());
    } catch (e) {
      return json(400, { error: e.message });
    }
    amountCents = quote.totalCents;
    productName = `Shipping deposit — ${quote.summary}`;
    metadata = { quote_id: body.quoteId || '', cargo: quote.summary, total_cents: String(amountCents) };
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: body.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: productName,
              description: testMode
                ? 'TEST MODE — no real charge. FCS Shipping LLC.'
                : 'FCS Shipping LLC. — Brooklyn to the Caribbean.',
            },
          },
        },
      ],
      metadata,
      success_url: `${siteUrl}/?paid=1#quote`,
      cancel_url: `${siteUrl}/?canceled=1#quote`,
    });
    return json(200, { url: session.url, testMode });
  } catch (e) {
    console.error('Stripe error:', e.message);
    return json(502, { error: 'Could not start checkout. Please call us instead.' });
  }
};
