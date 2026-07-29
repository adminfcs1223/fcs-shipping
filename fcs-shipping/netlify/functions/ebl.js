/* EB/L lookup — customers enter the EB/L number our office gave them and the
   exact pre-priced bill of lading loads on the site. Returns no personal data. */

const { supabaseConfigured, sb, json, rateLimited } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const ip = event.headers['x-nf-client-connection-ip'] || 'unknown';
  if (rateLimited(ip, 30, 60 * 1000)) return json(429, { error: 'Slow down, please.' });

  const no = String((event.queryStringParameters || {}).no || '').trim().toUpperCase();
  if (!/^EBL-\d{4}-\d{3,6}$/.test(no)) {
    return json(400, { error: 'EB/L numbers look like EBL-2026-1001.' });
  }

  if (!supabaseConfigured()) return json(503, { error: 'EB/L lookup not available yet' });

  try {
    const rows = await sb(
      `ebl?ebl_no=eq.${encodeURIComponent(no)}&select=ebl_no,cargo,quantity,cuft,destination,price_cents,status`
    );
    if (!rows || !rows.length || rows[0].status === 'void') return json(404, { error: 'Not found' });
    return json(200, rows[0]);
  } catch (e) {
    console.error('ebl lookup error:', e.message);
    return json(502, { error: 'Lookup temporarily unavailable' });
  }
};
