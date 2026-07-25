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

  let quote;
  try {
    quote = computeQuote(body, await getPricing());
  } catch (e) {
    return json(400, { error: e.message });
  }

  const stripe = require('stripe')(key);
  const siteUrl = process.env.URL || 'http://localhost:8888';
  const testMode = key.startsWith('sk_test');

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: body.email || undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: quote.totalCents,
            product_data: {
              name: `Shipping deposit — ${quote.summary}`,
              description: testMode
                ? 'TEST MODE — no real charge. FCS Shipping LLC.'
                : 'Deposit for FCS Shipping LLC. Final rate confirmed when cargo is weighed and manifested.',
            },
          },
        },
      ],
      metadata: {
        quote_id: body.quoteId || '',
        cargo: quote.summary,
        total_cents: String(quote.totalCents),
      },
      success_url: `${siteUrl}/?paid=1#quote`,
      cancel_url: `${siteUrl}/?canceled=1#quote`,
    });
    return json(200, { url: session.url, testMode });
  } catch (e) {
    console.error('Stripe error:', e.message);
    return json(502, { error: 'Could not start checkout. Please call us instead.' });
  }
};
