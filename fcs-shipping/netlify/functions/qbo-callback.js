/* Step 2: Intuit sends the staff member back here with a code.
   We swap it for tokens and store them server-side, then return to order entry. */

const qbo = require('./utils/qbo');

function page(title, msg, ok) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html' },
    body: `<!doctype html><meta charset="utf-8">
      <body style="font:15px/1.6 system-ui;padding:44px;max-width:600px;margin:auto;text-align:center">
      <h2 style="color:${ok ? '#0B5C8A' : '#a11b1b'}">${title}</h2>
      <p>${msg}</p>
      <p style="margin-top:26px"><a href="/admin/orders/#settings"
         style="background:#0B5C8A;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">
         ← Back to order entry</a></p></body>`,
  };
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  if (p.error) return page('QuickBooks connection cancelled', p.error_description || p.error, false);
  if (!p.code || !p.realmId) return page('Missing details from QuickBooks', 'Try connecting again.', false);

  /* CSRF check: the state must match the single-use value we stored when
     the connection started. A mismatch means this callback wasn't started
     by you — we refuse it. */
  const stateOk = await qbo.consumeState(p.state);
  if (!stateOk) {
    return page('Security check failed', 'This connection attempt could not be verified. Start again from Order entry → Settings → Connect QuickBooks.', false);
  }

  try {
    await qbo.exchangeCode(p.code, p.realmId, process.env.URL);
    return page('QuickBooks connected', 'Invoices created from order entry will now post to your books automatically.', true);
  } catch (e) {
    console.error('QBO callback error:', e.message);
    return page("Couldn't finish connecting", e.message, false);
  }
};
