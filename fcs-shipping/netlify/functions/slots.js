/* Public: list available pickup/drop-off time slots (next 30 days).
   Only id + date + time leave the server — never who booked what. */

const { supabaseConfigured, sb, json } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  if (!supabaseConfigured()) return json(200, []);

  try {
    const today = new Date().toISOString().slice(0, 10);
    const max = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const rows = await sb(
      `pickup_slots?slot_date=gte.${today}&slot_date=lte.${max}` +
      `&select=id,slot_date,slot_time,status,held_until&order=slot_date.asc,slot_time.asc&limit=200`
    );
    const now = Date.now();
    const available = (rows || []).filter((r) =>
      r.status === 'open' ||
      (r.status === 'held' && (!r.held_until || new Date(r.held_until).getTime() < now))
    );
    return json(200, available.map(({ id, slot_date, slot_time }) => ({ id, slot_date, slot_time })));
  } catch (e) {
    console.error('slots list failed:', e.message);
    return json(200, []);
  }
};
