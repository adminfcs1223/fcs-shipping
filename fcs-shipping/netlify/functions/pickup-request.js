/* Request-a-Pickup wizard submissions.
   Three flavours: 'pickup' (barrel/bin/box), 'amazon' (mail-in heads-up),
   'supplies' (empty barrels/bins only). Stores in quote_requests so the
   admin Quotes tab + "Create order" flow work unchanged, and emails the office.
   Price is estimated SERVER-side when the cargo/destination allow it. */

const { config, getPricing, computeQuote, supabaseConfigured, sb, json, rateLimited } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  /* spam protection */
  if (b.website) return json(200, { ok: true });
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (rateLimited(ip)) return json(429, { error: 'Too many requests — please call us instead.' });

  const S = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 160);
  const sender = b.sender || {};
  const consignee = b.consignee || {};
  const name = S(sender.name, 120);
  const phone = S(sender.phone, 40);
  if (!name || !phone) return json(400, { error: 'Name and phone number are required.' });

  const type = ['pickup', 'amazon', 'supplies'].includes(b.type) ? b.type : 'pickup';
  const item = S(b.item, 30);
  const destination = S(b.destination, 80);
  const pricing = await getPricing();

  /* server-side estimate when possible; never trusted from the client */
  let totalCents = 0, summaryBits = [];
  const ITEM_LABELS = { barrel: 'Barrel', bin: 'Commercial Bin', box: 'Box', amazon: 'Online-order mail-in' };
  if (type === 'pickup' && item && destination) {
    try {
      const q = computeQuote({
        items: [{ cargoId: item, quantity: 1 }],
        destination,
        extras: b.insurance ? ['insurance'] : [],
        supplies: b.supplies || {},
        supplyDelivery: Boolean(b.supplyDelivery),
      }, pricing);
      totalCents = q.totalCents;
      summaryBits.push(q.summary);
    } catch (e) {
      summaryBits.push(`${ITEM_LABELS[item] || item}${destination ? ' → ' + destination : ''} (priced at pickup)`);
    }
  } else if (type === 'supplies') {
    const sIn = b.supplies || {};
    const bits = [];
    (pricing.supplies || []).forEach((sp) => {
      const n = Math.min(Math.max(parseInt(sIn[sp.id], 10) || 0, 0), 50);
      if (n > 0) { totalCents += Math.round(sp.price * 100) * n; bits.push(`${sp.label} × ${n}`); }
    });
    if (totalCents > 0 && b.supplyDelivery) totalCents += Math.round((pricing.suppliesDeliveryFee || 5) * 100);
    summaryBits.push('SUPPLIES ONLY: ' + (bits.join(', ') || 'not specified') + (b.supplyDelivery ? ' + home delivery' : ''));
  } else {
    summaryBits.push('AMAZON/ONLINE-ORDER MAIL-IN — packages coming to the warehouse');
  }

  const address = [S(sender.street, 120), S(sender.apt, 40), S(sender.city, 60),
    S(sender.state, 20), S(sender.zip, 15)].filter(Boolean).join(', ');
  const consigneeLine = [S(consignee.name, 120), S(consignee.address, 200), S(consignee.country, 60),
    S(consignee.phone, 40)].filter(Boolean).join(' · ');

  /* store — rides the existing quote_requests pipeline */
  let requestId = null;
  if (supabaseConfigured()) {
    try {
      const rows = await sb('quote_requests', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          name, phone,
          email: S(sender.email) || 'none@given.com',
          address: address || null,
          pickup_slot: S(sender.date, 20) ? `Requested: ${S(sender.date, 20)}` : null,
          cargo: summaryBits.join(' | ').slice(0, 400),
          quantity: 1,
          destination: destination || (type === 'amazon' ? 'TBD (mail-in)' : 'TBD'),
          extras: [
            b.insurance ? 'Insurance' : null,
            consigneeLine ? 'Consignee: ' + consigneeLine : null,
            S(sender.phone2, 40) ? 'Alt phone: ' + S(sender.phone2, 40) : null,
          ].filter(Boolean),
          total_cents: totalCents,
          status: 'new',
        },
      });
      requestId = rows && rows[0] && rows[0].id;
    } catch (e) {
      console.error('pickup-request insert failed:', e.message);
    }
  }

  /* email the office */
  if (process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('PLACEHOLDER')) {
    try {
      const TYPE_TITLES = { pickup: 'PICKUP REQUEST', amazon: 'INCOMING MAIL-IN (Amazon/online order)', supplies: 'SUPPLIES ORDER' };
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.QUOTE_EMAIL_FROM || 'FCS Website <onboarding@resend.dev>',
          to: [process.env.QUOTE_EMAIL_TO || config.company.email],
          reply_to: S(sender.email) || undefined,
          subject: `${TYPE_TITLES[type]} — ${name}${totalCents ? ' — $' + (totalCents / 100).toFixed(2) : ''}`,
          text: [
            TYPE_TITLES[type] + ' from the website:',
            '',
            `Name:    ${name}`,
            `Phone:   ${phone}${S(sender.phone2) ? ' / ' + S(sender.phone2, 40) : ''}`,
            `Email:   ${S(sender.email) || '(not given)'}`,
            `Address: ${address || '(not given)'}`,
            `Pickup date: ${S(sender.date, 20) || '(not given)'}`,
            '',
            `What:    ${summaryBits.join(' | ')}`,
            `Destination: ${destination || '(not set)'}`,
            totalCents ? `Estimated total: $${(totalCents / 100).toFixed(2)}` : 'Estimate: to be priced',
            '',
            'Consignee: ' + (consigneeLine || '(not given)'),
            consignee.email ? 'Consignee email: ' + S(consignee.email) : '',
            '',
            requestId ? `Ref: ${requestId} (admin dashboard → Quotes → "Create order")` : '(Not saved to database)',
          ].filter((l) => l !== '').join('\n'),
        }),
      });
      if (!res.ok) console.error('Resend error:', res.status, await res.text());
    } catch (e) {
      console.error('Resend failed:', e.message);
    }
  }

  return json(200, { ok: true, requestId, total: totalCents });
};
