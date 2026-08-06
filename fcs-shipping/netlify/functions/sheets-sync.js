/* Proxies FCS Admin V2 "Update sheet" clicks to the Google Apps Script
   webhook (browsers can't call Apps Script directly — no CORS). Staff-only.
   The webhook URL lives in admin Settings; only script.google.com is allowed. */

const { json } = require('./utils/shared');
const { requireStaff } = require('./utils/staff');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const gate = await requireStaff(event);
  if (!gate.ok) return json(401, { error: gate.error });

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON' }); }

  const hook = String(b.hook || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(hook)) {
    return json(400, { error: 'That does not look like an Apps Script webhook URL (…/macros/s/…/exec).' });
  }
  if (!b.payload || typeof b.payload !== 'object') return json(400, { error: 'Missing payload' });

  try {
    /* Apps Script replies through a redirect — follow it */
    const res = await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(b.payload),
      redirect: 'follow',
    });
    const text = await res.text();
    let d = null;
    try { d = JSON.parse(text); } catch { /* HTML error page */ }
    if (!res.ok || !d || d.ok !== true) {
      return json(502, { error: (d && d.error) || ('The sheet script said no (' + res.status + '). Re-deploy the Apps Script and check the URL.') });
    }
    return json(200, { ok: true, url: d.url || null, note: d.note || null });
  } catch (e) {
    return json(502, { error: 'Could not reach the sheet script: ' + e.message });
  }
};
