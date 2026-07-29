/* Staff-only: read or set an EB/L's paid status, and report QuickBooks connection state.
   GET  ?no=EBL-2026-1001   → { ebl_no, status, price_cents, qb_invoice_no }
   GET  ?qbstatus=1         → QuickBooks connection info for the Settings tab
   POST { eblNo, status }   → 'paid' | 'open'  (also marks the QuickBooks invoice paid-in-full)
*/

const { supabaseConfigured, sb, json } = require('./utils/shared');
const { requireStaff } = require('./utils/staff');
const qbo = require('./utils/qbo');

exports.handler = async (event) => {
  const gate = await requireStaff(event);
  if (!gate.ok) return json(401, { error: gate.error });

  if (event.httpMethod === 'GET') {
    const p = event.queryStringParameters || {};
    if (p.qbstatus) return json(200, await qbo.status());
    if (!supabaseConfigured()) return json(503, { error: 'Supabase not configured' });
    const no = String(p.no || '').trim().toUpperCase();
    if (!/^EBL-\d{4}-\d{3,6}$/.test(no)) return json(400, { error: 'Bad EB/L number' });
    const rows = await sb(`ebl?ebl_no=eq.${encodeURIComponent(no)}&select=ebl_no,status,price_cents,qb_invoice_no,cargo,destination`);
    if (!rows || !rows.length) return json(404, { error: 'Not found' });
    return json(200, rows[0]);
  }

  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!supabaseConfigured()) return json(503, { error: 'Supabase not configured' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const no = String(b.eblNo || '').trim().toUpperCase();
  const status = b.status === 'paid' ? 'paid' : b.status === 'void' ? 'void' : 'open';
  if (!/^EBL-\d{4}-\d{3,6}$/.test(no)) return json(400, { error: 'Bad EB/L number' });

  try {
    const rows = await sb(`ebl?ebl_no=eq.${encodeURIComponent(no)}&select=ebl_no,qb_invoice_id,price_cents`);
    if (!rows || !rows.length) return json(404, { error: 'EB/L not found' });

    await sb(`ebl?ebl_no=eq.${encodeURIComponent(no)}`, { method: 'PATCH', body: { status } });

    /* mirror the payment into QuickBooks so the books aren't left showing it open */
    let qb = { attempted: false };
    const invId = rows[0].qb_invoice_id;
    if (status === 'paid' && invId && qbo.configured()) {
      qb.attempted = true;
      try {
        const inv = await qbo.qbo(`invoice/${invId}`);
        const I = inv.Invoice;
        if (I && Number(I.Balance) > 0) {
          await qbo.qbo('payment', {
            method: 'POST',
            body: {
              CustomerRef: I.CustomerRef,
              TotalAmt: Number(I.Balance),
              Line: [{
                Amount: Number(I.Balance),
                LinkedTxn: [{ TxnId: I.Id, TxnType: 'Invoice' }],
              }],
            },
          });
          qb.ok = true;
        } else { qb.ok = true; qb.note = 'already settled'; }
      } catch (e) {
        console.error('QB payment failed:', e.message);
        qb.error = e.message;
      }
    }
    return json(200, { ok: true, eblNo: no, status, quickbooks: qb });
  } catch (e) {
    console.error('ebl-status error:', e.message);
    return json(502, { error: e.message });
  }
};
