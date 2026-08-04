/* Shared helpers for Netlify functions. Not deployed as an endpoint. */

const config = require('../../../site.config.json');

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
  const text = await res.text();
  if (!text) return null; /* e.g. 201 upserts without return=representation */
  return JSON.parse(text);
}

/* ---- pricing: site.config.json, overridden by the admin-edited `settings`
        table (key 'pricing') when Supabase is configured ---- */
async function getPricing() {
  const base = {
    cargo: config.cargo,
    destinations: config.destinations,
    extras: config.extras,
    supplies: config.supplies,
    suppliesDeliveryFee: config.suppliesDeliveryFee || 5,
    arrivalCountry: config.arrivalCountry || 'St. Lucia',
    team: config.team || [],
  };
  if (supabaseConfigured()) {
    try {
      const rows = await sb(`settings?key=eq.pricing&select=value`);
      if (rows && rows[0] && rows[0].value) {
        const v = rows[0].value;
        return {
          cargo: v.cargo || base.cargo,
          destinations: v.destinations || base.destinations,
          extras: v.extras || base.extras,
          supplies: v.supplies || base.supplies,
          suppliesDeliveryFee: v.suppliesDeliveryFee != null ? v.suppliesDeliveryFee : base.suppliesDeliveryFee,
          arrivalCountry: v.arrivalCountry || base.arrivalCountry,
          team: Array.isArray(v.team) ? v.team : base.team,
        };
      }
    } catch (e) {
      console.error('settings/pricing lookup failed, using site.config.json:', e.message);
    }
  }
  return base;
}

/* ---- quote totals: ALWAYS computed server-side.
        v4: multiple cargo items per quote (barrel + bin together).
        Flat per-destination prices (cargo.prices[destName]) win;
        otherwise cu ft × destination rate. Legacy single-cargo input
        ({cargoId, quantity, dims}) still works. ---- */
function computeQuote(input, pricing) {
  const p = pricing || {
    cargo: config.cargo, destinations: config.destinations, extras: config.extras,
    supplies: config.supplies, suppliesDeliveryFee: config.suppliesDeliveryFee || 5,
  };
  const dest = p.destinations.find((d) => d.name === input.destination);
  if (!dest) throw new Error('Unknown destination');
  if (dest.call) throw new Error('Call (718) 483-8006 for exact rates to other islands');

  const rawItems = (Array.isArray(input.items) && input.items.length)
    ? input.items.slice(0, 10)
    : [{ cargoId: input.cargoId, quantity: input.quantity, dims: input.dims }];

  let freightCents = 0, totalCuft = 0, totalQty = 0;
  const itemLabels = [];
  for (const it of rawItems) {
    const cargo = p.cargo.find((c) => c.id === it.cargoId);
    if (!cargo) throw new Error('Unknown cargo type');
    if (cargo.ebl) throw new Error('EB/L bills are paid with the exact price on file — enter your EB/L number');

    const qty = Math.min(Math.max(parseInt(it.quantity, 10) || 1, 1), 50);
    let cuft = cargo.cuft || 0;
    if (cargo.custom) {
      const d = it.dims || input.dims || {};
      const l = Number(d.l), w = Number(d.w), h = Number(d.h);
      if (!(l > 0 && w > 0 && h > 0) || l > 1000 || w > 1000 || h > 1000) {
        throw new Error('Please enter the box length, width, and height in inches');
      }
      cuft = Math.max(1, Math.round((l * w * h) / 1728 * 10) / 10);
    }
    const flat = cargo.prices && cargo.prices[dest.name] != null ? Number(cargo.prices[dest.name]) : null;
    if (flat == null && !dest.rate) throw new Error('Call (718) 483-8006 for exact rates to other islands');

    freightCents += flat != null
      ? Math.round(flat * qty * 100)
      : Math.round(cuft * (dest.rate || 0) * qty * 100);
    totalCuft += cuft * qty;
    totalQty += qty;
    itemLabels.push(`${cargo.label} × ${qty}`);
  }
  if (!itemLabels.length) throw new Error('Nothing to quote yet');

  const extraItems = (Array.isArray(input.extras) ? input.extras : [])
    .map((id) => p.extras.find((x) => x.id === id))
    .filter(Boolean);
  const extrasCents = extraItems.reduce((s, x) => s + Math.round(x.price * 100), 0);

  const supplyLabels = [];
  let suppliesCents = 0, suppliesN = 0;
  const sIn = input.supplies || {};
  p.supplies.forEach((s) => {
    const n = Math.min(Math.max(parseInt(sIn[s.id], 10) || 0, 0), 50);
    if (n > 0) {
      suppliesCents += Math.round(s.price * 100) * n;
      suppliesN += n;
      supplyLabels.push(`${s.label} × ${n}`);
    }
  });
  if (suppliesN > 0 && input.supplyDelivery) {
    suppliesCents += Math.round((p.suppliesDeliveryFee || 5) * 100);
    supplyLabels.push('Supply home delivery');
  }

  const totalCents = freightCents + extrasCents + suppliesCents;
  if (totalCents <= 0) throw new Error('Nothing to quote yet');

  return {
    cargoLabel: itemLabels.join(', '),
    itemLabels,
    quantity: totalQty,
    cuft: totalCuft,               /* TOTAL cubic feet across all items */
    destination: dest.name,
    rate: dest.rate,
    extraLabels: extraItems.map((x) => x.label),
    supplyLabels,
    freightCents,
    totalCents,
    summary: `${itemLabels.join(', ')} (${totalCuft} cu ft) → ${dest.name}` +
      (extraItems.length ? ' + ' + extraItems.map((x) => x.label).join(', ') : '') +
      (supplyLabels.length ? ' + ' + supplyLabels.join(', ') : ''),
  };
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
/* generous enough that no human ever hits it (offices/families share IPs);
   still stops scripted floods cold */
function rateLimited(ip, max = 30, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

module.exports = { config, getPricing, computeQuote, supabaseConfigured, sb, json, rateLimited };
