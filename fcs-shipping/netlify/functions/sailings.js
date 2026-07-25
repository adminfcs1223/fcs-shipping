/* Phase 4 — live sailing schedule from Supabase, with site.config.json fallback. */

const { config, supabaseConfigured, sb, json } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  if (supabaseConfigured()) {
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const rows = await sb(
        `sailings?departs=gte.${weekAgo}&select=vessel,departs,arrives,cutoff,status&order=departs.asc&limit=8`
      );
      if (rows && rows.length) return json(200, rows);
    } catch (e) {
      console.error('sailings error:', e.message);
    }
  }
  /* fallback: schedule from site.config.json */
  return json(200, config.sailings);
};
