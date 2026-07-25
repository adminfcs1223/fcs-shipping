/* Shared helpers for Netlify functions. Not deployed as an endpoint. */

const config = require('../../../site.config.json');

/* ---- pricing: site.config.json, overridden by the admin-edited `settings`
        table (key 'pricing') when Supabase is configured ---- */
async function getPricing() {
  if (supabaseConfigured()) {
    try {
      const rows = await sb(`settings?key=eq.pricing&select=value`);
      if (rows && rows[0] && rows[0].value) {
        const v = rows[0].value;
        return {
          cargo: v.cargo || config.cargo,
          destinations: v.destinations || config.destinations,
          extras: v.extras || config.extras,
        };
      }
    } catch (e) {
      console.error('settings/pricing lookup failed, using site.config.json:', e.message);
    }
  }
  return { cargo: config.cargo, destinations: config.destinations, extras: config.extras };
}

/* ---- quote totals: ALWAYS computed server-side ---- */
function computeQuote({ cargoId, quantity, destination, extras }, pricing = config) {
  const cargo = pricing.cargo.find((c) => c.id === cargoId);
  if (!cargo) throw new Error('Unknown cargo type');
  const qty = Math.min(Math.max(parseInt(quantity, 10) || 1, 1), 20);
  const dest = pricing.destinations.find((d) => d.name === destination);
  if (!dest) throw new Error('Unknown destination');
  const extraItems = (Array.isArray(extras) ? extras : [])
    .map((id) => pricing.extras.find((x) => x.id === id))
    .filter(Boolean);
  const extrasTotal = extraItems.reduce((s, x) => s + x.price, 0);
  const total = cargo.price * qty + dest.fee * qty + extrasTotal;
  return {
    cargoLabel: cargo.label,
    quantity: qty,
    destination: dest.name,
    extraLabels: extraItems.map((x) => x.label),
    totalCents: Math.round(total * 100),
    summary: `${cargo.label} × ${qty} → ${dest.name}${extraItems.length ? ' + ' + extraItems.map((x) => x.label).join(', ') : ''}`,
  };
}

/* ---- Supabase REST (service role key — server only, never in the client) ---- */
function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function sb(pathAndQuery, { method = 'GET', body, prefer } = {}) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/${pathAndQuery}`;
  const headers = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${pathAndQuery} → ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ---- responses ---- */
function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/* ---- naive in-memory rate limit (per warm function instance) ---- */
const hits = new Map();
function rateLimited(ip, max = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

module.exports = { config, getPricing, computeQuote, supabaseConfigured, sb, json, rateLimited };
