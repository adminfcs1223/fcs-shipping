/* Receipts on the road: staff hits "Email receipt" in Order entry, types the
   customer's address, and this sends a clean branded receipt. Staff-only. */

const { config, json } = require('./utils/shared');
const { requireStaff } = require('./utils/staff');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const gate = await requireStaff(event);
  if (!gate.ok) return json(401, { error: gate.error });

  if (!process.env.RESEND_API_KEY || process.env.RESEND_API_KEY.includes('PLACEHOLDER')) {
    return json(503, { error: 'Email is not configured yet (RESEND_API_KEY).' });
  }

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const S = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 160);
  const to = S(b.to);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json(400, { error: 'That e-mail address does not look right.' });

  const o = b.order || {};
  const inv = S(o.inv, 30);
  const customer = S(o.customer, 120) || 'Customer';
  const items = (Array.isArray(o.items) ? o.items : []).slice(0, 30)
    .map((it) => ({ qty: S(it.qty, 10), desc: S(it.desc, 160), amount: S(it.amount, 20) }))
    .filter((it) => it.desc);
  const total = S(o.total, 20);
  const eblNo = S(o.eblNo, 30);
  const paid = Boolean(o.paid);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const rows = items.map((it) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${esc(it.qty)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(it.desc)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${esc(it.amount)}</td>
    </tr>`).join('');

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#111">
    <div style="background:#111;color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
      <div style="font-size:20px;font-weight:900;letter-spacing:.04em">FCS SHIPPING LLC.</div>
      <div style="font-size:11px;color:#BCD3E2;letter-spacing:.14em">BROOKLYN · NEW YORK · THE WORLD</div>
    </div>
    <div style="border:1px solid #E4E4E0;border-top:none;border-radius:0 0 10px 10px;padding:22px">
      <p style="margin:0 0 4px">Hi ${esc(customer)},</p>
      <p style="margin:0 0 16px">Thank you for shipping with FCS! Here is your receipt.</p>
      <table style="width:100%;font-size:13px;margin-bottom:14px">
        <tr><td style="color:#5C5C5C">Invoice / B/L Nº</td><td style="text-align:right;font-weight:700">${esc(inv)}</td></tr>
        ${o.date ? `<tr><td style="color:#5C5C5C">Date</td><td style="text-align:right">${esc(S(o.date, 20))}</td></tr>` : ''}
        ${o.destination ? `<tr><td style="color:#5C5C5C">Destination</td><td style="text-align:right">${esc(S(o.destination, 60))}</td></tr>` : ''}
        ${eblNo ? `<tr><td style="color:#5C5C5C">EB/L Nº</td><td style="text-align:right;font-weight:700">${esc(eblNo)}</td></tr>` : ''}
      </table>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr style="background:#F6F6F4">
          <th style="padding:6px 10px;text-align:center;width:44px">Qty</th>
          <th style="padding:6px 10px;text-align:left">Description</th>
          <th style="padding:6px 10px;text-align:right">Amount</th></tr>
        ${rows}
        <tr><td></td><td style="padding:10px;text-align:right;font-weight:900">TOTAL</td>
          <td style="padding:10px;text-align:right;font-weight:900">${esc(total)}</td></tr>
      </table>
      <p style="margin:16px 0 0;font-weight:700;color:${paid ? '#1E6B3A' : '#B45309'}">
        ${paid ? '✓ PAID — thank you!' : 'BALANCE DUE' + (eblNo ? ' — pay online at fcsshipping.com: choose “Have an EB/L number”, enter ' + esc(eblNo) + ', and pay by card.' : '')}
      </p>
      ${o.trackNote ? `<p style="margin:12px 0 0;font-size:13px">${esc(S(o.trackNote, 200))}</p>` : ''}
      <p style="margin:18px 0 0;font-size:12px;color:#5C5C5C">
        FCS Shipping LLC · 9502 Ditmas Ave, Building 4, Brooklyn NY 11236 · (718) 483-8006<br>
        Track your shipment anytime at www.fcsshipping.com
      </p>
    </div></div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.QUOTE_EMAIL_FROM || 'FCS Shipping <onboarding@resend.dev>',
        to: [to],
        reply_to: process.env.QUOTE_EMAIL_TO || config.company.email,
        subject: `Your FCS Shipping receipt — Invoice ${inv}${eblNo ? ' · ' + eblNo : ''}`,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('Resend error:', res.status, t);
      return json(502, { error: 'The email service refused it — is the fcsshipping.com domain verified in Resend?' });
    }
    return json(200, { ok: true });
  } catch (e) {
    return json(502, { error: 'Could not send: ' + e.message });
  }
};
