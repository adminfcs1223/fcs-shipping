/* QuickBooks Online helper — OAuth token handling + Accounting API calls.
   Tokens live in the Supabase `settings` table under key 'qb:tokens'
   (written with the service-role key, so they never touch the browser).

   Env vars needed in Netlify:
     QB_CLIENT_ID       — Intuit app "Client ID"
     QB_CLIENT_SECRET   — Intuit app "Client Secret"
     QB_ENV             — "sandbox" (default) or "production"
*/

const { sb, supabaseConfigured } = require('./shared');

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const SCOPE = 'com.intuit.quickbooks.accounting';

function apiBase() {
  return (process.env.QB_ENV || 'sandbox') === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

function configured() {
  const id = process.env.QB_CLIENT_ID || '';
  const secret = process.env.QB_CLIENT_SECRET || '';
  return Boolean(id && secret && !id.includes('PLACEHOLDER') && !secret.includes('PLACEHOLDER'));
}

function redirectUri(siteUrl) {
  return `${siteUrl || process.env.URL || 'http://localhost:8888'}/.netlify/functions/qbo-callback`;
}

function authorizeUrl(siteUrl, state) {
  const p = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID,
    response_type: 'code',
    scope: SCOPE,
    redirect_uri: redirectUri(siteUrl),
    state: state || 'fcs',
  });
  return `${AUTH_URL}?${p.toString()}`;
}

function basicAuth() {
  return 'Basic ' + Buffer.from(
    `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
  ).toString('base64');
}

/* ---- token store ---- */
async function loadTokens() {
  if (!supabaseConfigured()) return null;
  const rows = await sb(`settings?key=eq.qb:tokens&select=value`);
  return rows && rows[0] ? rows[0].value : null;
}

async function saveTokens(t) {
  await sb('settings', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates',
    body: { key: 'qb:tokens', value: t, updated_at: new Date().toISOString() },
  });
}

/* ---- OAuth ---- */
async function exchangeCode(code, realmId, siteUrl) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(siteUrl),
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token exchange failed');
  const tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    realm_id: realmId,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
    connected_at: new Date().toISOString(),
  };
  await saveTokens(tokens);
  return tokens;
}

async function refresh(tokens) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || 'QuickBooks re-authorisation needed — reconnect in Settings.');
  const next = {
    ...tokens,
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + (data.expires_in - 60) * 1000,
  };
  await saveTokens(next);
  return next;
}

async function validTokens() {
  let t = await loadTokens();
  if (!t || !t.refresh_token) throw new Error('QuickBooks is not connected yet.');
  if (!t.access_token || Date.now() >= (t.expires_at || 0)) t = await refresh(t);
  return t;
}

/* ---- API ---- */
async function qbo(path, { method = 'GET', body, tokens } = {}) {
  const t = tokens || (await validTokens());
  const url = `${apiBase()}/v3/company/${t.realm_id}/${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${t.access_token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const f = data.Fault && data.Fault.Error && data.Fault.Error[0];
    throw new Error(f ? `${f.Message}${f.Detail ? ' — ' + f.Detail : ''}` : `QuickBooks ${res.status}`);
  }
  return data;
}

function q(s) { return String(s || '').replace(/'/g, "\\'"); }

async function findOrCreateCustomer(name, extra, tokens) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('Customer name required for the QuickBooks invoice');
  const found = await qbo(
    `query?query=${encodeURIComponent(`select Id, DisplayName from Customer where DisplayName = '${q(clean)}'`)}`,
    { tokens }
  );
  const hit = found.QueryResponse && found.QueryResponse.Customer && found.QueryResponse.Customer[0];
  if (hit) return hit.Id;

  const body = { DisplayName: clean };
  if (extra) {
    if (extra.phone) body.PrimaryPhone = { FreeFormNumber: extra.phone };
    if (extra.email && /\S+@\S+\.\S+/.test(extra.email)) body.PrimaryEmailAddr = { Address: extra.email };
    const line1 = extra.street, city = extra.city, region = extra.state;
    if (line1 || city || region) {
      body.BillAddr = {};
      if (line1) body.BillAddr.Line1 = line1;
      if (city) body.BillAddr.City = city;
      if (region) body.BillAddr.CountrySubDivisionCode = region;
    }
  }
  const made = await qbo('customer', { method: 'POST', body, tokens });
  return made.Customer.Id;
}

/* Creates an invoice. lines: [{ desc, qty, price, amount }] */
async function createInvoice({ customerName, customerExtra, docNumber, lines, memo, txnDate }) {
  const tokens = await validTokens();
  const customerId = await findOrCreateCustomer(customerName, customerExtra, tokens);

  const Line = (lines || [])
    .map((l) => {
      const amount = Number(l.amount) || 0;
      if (amount <= 0) return null;
      const detail = {};
      if (Number(l.qty) > 0) detail.Qty = Number(l.qty);
      if (Number(l.price) > 0) detail.UnitPrice = Number(l.price);
      return {
        DetailType: 'SalesItemLineDetail',
        Amount: Math.round(amount * 100) / 100,
        Description: String(l.desc || 'Shipping services').slice(0, 4000),
        SalesItemLineDetail: detail,
      };
    })
    .filter(Boolean);

  if (!Line.length) throw new Error('Nothing to invoice — add a line with an amount first.');

  const body = { CustomerRef: { value: customerId }, Line };
  if (docNumber) body.DocNumber = String(docNumber).slice(0, 21);
  if (memo) body.CustomerMemo = { value: String(memo).slice(0, 1000) };
  if (txnDate) body.TxnDate = txnDate;

  let made;
  try {
    made = await qbo('invoice', { method: 'POST', body, tokens });
  } catch (e) {
    /* duplicate invoice number — retry letting QuickBooks assign one */
    if (/Duplicate Document Number/i.test(e.message) && body.DocNumber) {
      delete body.DocNumber;
      made = await qbo('invoice', { method: 'POST', body, tokens });
    } else {
      throw e;
    }
  }

  const inv = made.Invoice || {};
  return {
    id: inv.Id,
    docNumber: inv.DocNumber,
    total: inv.TotalAmt,
    customerId,
  };
}

async function status() {
  if (!configured()) return { configured: false, connected: false };
  try {
    const t = await loadTokens();
    return {
      configured: true,
      connected: Boolean(t && t.refresh_token),
      realmId: t && t.realm_id,
      env: process.env.QB_ENV || 'sandbox',
      connectedAt: t && t.connected_at,
    };
  } catch {
    return { configured: true, connected: false };
  }
}

module.exports = {
  configured, authorizeUrl, exchangeCode, createInvoice, status, qbo, validTokens, saveTokens, loadTokens,
};
