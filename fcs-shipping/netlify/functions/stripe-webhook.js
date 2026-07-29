/* Phase 3 — Stripe webhook: marks the related quote_request as deposit paid.
   Configure the endpoint in Stripe: <site>/.netlify/functions/stripe-webhook
   listening for checkout.session.completed. */

const { supabaseConfigured, sb, json } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const key = process.env.STRIPE_SECRET_KEY || '';
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!key || key.includes('PLACEHOLDER') || !whSecret || whSecret.includes('PLACEHOLDER')) {
    return json(503, { error: 'Stripe not configured' });
  }

  const stripe = require('stripe')(key);
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      whSecret
    );
  } catch (e) {
    console.error('Webhook signature verification failed:', e.message);
    return json(400, { error: 'Invalid signature' });
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const eblNo = session.metadata && session.metadata.ebl_no;
    if (eblNo && supabaseConfigured()) {
      try {
        await sb(`ebl?ebl_no=eq.${encodeURIComponent(eblNo)}`, {
          method: 'PATCH',
          body: { status: 'paid', stripe_session_id: session.id },
        });
        console.log(`EB/L ${eblNo} marked paid (${session.id})`);
      } catch (e) {
        console.error('Failed to update EB/L:', e.message);
        return json(500, { error: 'DB update failed' });
      }
    }
    const quoteId = session.metadata && session.metadata.quote_id;
    if (quoteId && supabaseConfigured()) {
      try {
        await sb(`quote_requests?id=eq.${encodeURIComponent(quoteId)}`, {
          method: 'PATCH',
          body: {
            status: 'deposit_paid',
            stripe_session_id: session.id,
            deposit_cents: session.amount_total,
          },
        });
        console.log(`Quote ${quoteId} marked deposit_paid (${session.id})`);
      } catch (e) {
        console.error('Failed to update quote request:', e.message);
        return json(500, { error: 'DB update failed' }); // Stripe will retry
      }
    } else {
      console.log('checkout.session.completed with no quote_id or Supabase not configured', session.id);
    }
  }

  return json(200, { received: true });
};
