/* Phase 5 — current pricing for the public site.
   Returns admin-edited prices from the `settings` table when available,
   otherwise the prices in site.config.json. */

const { getPricing, json } = require('./utils/shared');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });
  return json(200, await getPricing());
};
