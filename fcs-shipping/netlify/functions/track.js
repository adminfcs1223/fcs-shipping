/* Phase 4 — public tracking. Looks up a waybill and returns ONLY non-PII fields
   (no customer name/phone ever reaches the browser).
   Falls back to a demo shipment until Supabase is configured. */

const { supabaseConfigured, sb, json, rateLimited } = require('./utils/shared');

const DEMO = {
  waybill_no: 'FCS-2026-4471',
  status: 'at_sea',
  vessel: 'M/V Caribbean Star',
  destination: 'Vieux-Fort',
  eta: '2026-07-28',
  events: [
    { status: 'received', note: '9502 Ditmas Ave', created_at: '2026-07-14T10:22:00-04:00' },
    { status: 'loaded', note: 'Container BKLN-88', created_at: '2026-07-17T15:05:00-04:00' },
    { status: 'at_sea', note: 'Aboard M/V Caribbean Star', created_at: '2026-07-19T08:00:00-04:00' },
  ],
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const ip = event.headers['x-nf-client-connection-ip'] || 'unknown';
  if (rateLimited(ip, 30, 60 * 1000)) return json(429, { error: 'Slow down, please.' });

  /* Accepts EITHER the FCS waybill number (FCS-2026-4471), our EB/L number
     (EBL-2026-0042), or a carrier eBL / booking number stored on the shipment. */
  const no = String((event.queryStringParameters || {}).waybill || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9\/\-]{3,30}$/.test(no)) {
    return json(400, { error: 'Enter your FCS waybill (FCS-2026-4471) or eBL tracking number.' });
  }

  if (!supabaseConfigured()) {
    if (no === DEMO.waybill_no) return json(200, DEMO);
    return json(404, { error: 'Not found' });
  }

  try {
    /* SELECT only safe columns — customer_name / customer_phone stay server-side */
    const enc = encodeURIComponent(no);
    const filter = `or=(waybill_no.eq.${enc},ebl_no.eq.${enc})`;
    const rows = await sb(
      `shipments?${filter}&select=id,waybill_no,status,vessel,destination,eta&limit=1`
    );
    if (!rows || !rows.length) return json(404, { error: 'Not found' });
    const { id, ...shipment } = rows[0];

    const events = await sb(
      `shipment_events?shipment_id=eq.${id}&select=status,note,created_at&order=created_at.asc`
    );

    return json(200, { ...shipment, events: events || [] });
  } catch (e) {
    console.error('track error:', e.message);
    return json(502, { error: 'Tracking temporarily unavailable' });
  }
};
