/* Turns a saved order-entry order into:
     1. an EB/L the customer can pay online, and
     2. a QuickBooks invoice for the books (if QuickBooks is connected).

   Staff-only. The EB/L always gets created; QuickBooks failing never blocks it —
   the response says what worked so the dashboard can show it plainly. */

const { supabaseConfigured, sb, json } = require('./utils/shared');
const { requireStaff } = require('./utils/staff');
const qbo = require('./utils/qbo');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const gate = await requireStaff(event);
  if (!gate.ok) return json(401, { error: gate.error });
  if (!supabaseConfigured()) return json(503, { error: 'Supabase not configured' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const cargo = String(b.cargo || '').trim() || 'Shipping services';
  const priceCents = Math.round(Number(b.priceCents) || 0);
  if (priceCents <= 0) return json(400, { error: 'The order needs a total above $0 before it can be billed.' });

  const customerName = String(b.customerName || '').trim();
  if (!customerName) return json(400, { error: 'The order needs a shipper name.' });

  /* ---------- 1. EB/L ---------- */
  let eblNo;
  try {
    const gen = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/generate_ebl`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!gen.ok) throw new Error('EB/L number generator failed');
    eblNo = (await gen.json());
    if (typeof eblNo !== 'string') throw new Error('Unexpected EB/L number');

    await sb('ebl', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        ebl_no: eblNo,
        bl_no: b.blNo || null,
        cargo,
        quantity: Math.max(1, parseInt(b.quantity, 10) || 1),
        cuft: b.cuft != null && b.cuft !== '' ? Number(b.cuft) : null,
        destination: b.destination || null,
        price_cents: priceCents,
        customer_email: b.customerEmail || null,
        order_inv: b.orderInv || null,
        status: b.markPaid ? 'paid' : 'open',
      },
    });
  } catch (e) {
    console.error('EB/L creation failed:', e.message);
    return json(502, { error: 'Could not create the EB/L: ' + e.message });
  }

  /* ---------- 2. QuickBooks invoice (best effort) ---------- */
  let qb = { attempted: false, ok: false };
  if (qbo.configured()) {
    qb.attempted = true;
    try {
      const lines = (Array.isArray(b.lines) && b.lines.length)
        ? b.lines
        : [{ desc: cargo, qty: b.quantity, price: priceCents / 100 / Math.max(1, b.quantity || 1), amount: priceCents / 100 }];
      const inv = await qbo.createInvoice({
        customerName,
        customerExtra: b.customerExtra || null,
        docNumber: b.orderInv || null,
        lines,
        memo: `FCS ${eblNo}${b.destination ? ' · ' + b.destination : ''}`,
        txnDate: b.txnDate || null,
      });
      qb.ok = true;
      qb.invoiceId = inv.id;
      qb.docNumber = inv.docNumber;
      qb.total = inv.total;

      try {
        await sb(`ebl?ebl_no=eq.${encodeURIComponent(eblNo)}`, {
          method: 'PATCH',
          body: { qb_invoice_id: inv.id, qb_invoice_no: inv.docNumber },
        });
      } catch (e) { console.error('Could not stamp QB ids on EB/L:', e.message); }
    } catch (e) {
      console.error('QuickBooks invoice failed:', e.message);
      qb.error = e.message;
    }
  }

  return json(200, { ok: true, eblNo, priceCents, quickbooks: qb });
};
