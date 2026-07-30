/* Public: put a 15-minute hold on a pickup slot while the customer finishes
   their quote. The conditional PATCH means two people can't hold the same
   slot — whoever's request lands first wins. */

const { supabaseConfigured, sb, json, rateLimited } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!supabaseConfigured()) return json(503, { error: 'Booking is not available right now' });

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  if (rateLimited(ip, 20)) return json(429, { error: 'Too many requests — please call us instead.' });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }
  const slotId = String(b.slotId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(slotId)) return json(400, { error: 'Invalid slot' });

  try {
    const nowIso = new Date().toISOString();
    const holdUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    /* only grabs the slot if it's open, or a previous hold has expired */
    const rows = await sb(
      `pickup_slots?id=eq.${slotId}&or=(status.eq.open,and(status.eq.held,held_until.lt.${encodeURIComponent(nowIso)}))`,
      { method: 'PATCH', prefer: 'return=representation', body: { status: 'held', held_until: holdUntil } }
    );
    if (!rows || !rows.length) {
      return json(409, { error: 'That time was just taken — please pick another.' });
    }
    const s = rows[0];
    return json(200, { ok: true, holdUntil, slot: { id: s.id, slot_date: s.slot_date, slot_time: s.slot_time } });
  } catch (e) {
    console.error('slot hold failed:', e.message);
    return json(502, { error: 'Could not hold that time — please try again.' });
  }
};
