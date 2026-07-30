/* Step 1 of connecting QuickBooks: send the staff member to Intuit to authorise.
   Opened from the order-entry Settings tab. */

const qbo = require('./utils/qbo');
const { json } = require('./utils/shared');

exports.handler = async (event) => {
  if (!qbo.configured()) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html' },
      body: `<!doctype html><meta charset="utf-8">
        <body style="font:15px/1.5 system-ui;padding:40px;max-width:620px;margin:auto">
        <h2>QuickBooks isn't set up yet</h2>
        <p>Add these to Netlify → Site configuration → Environment variables, then redeploy:</p>
        <ul>
          <li><code>QB_CLIENT_ID</code></li>
          <li><code>QB_CLIENT_SECRET</code></li>
          <li><code>QB_ENV</code> — <code>sandbox</code> while testing, <code>production</code> when live</li>
        </ul>
        <p>Get them from an app you create at <a href="https://developer.intuit.com">developer.intuit.com</a>.
        Set that app's redirect URI to:<br>
        <code>${(process.env.URL || '')}/.netlify/functions/qbo-callback</code></p>
        <p><a href="/admin/orders/">← Back to order entry</a></p></body>`,
    };
  }
  /* CSRF protection: random single-use state, stored server-side and
     verified when Intuit redirects back to qbo-callback. */
  let state;
  try {
    state = await qbo.newState();
  } catch (e) {
    console.error('Could not store OAuth state:', e.message);
    return json(503, { error: 'Connect Supabase first — the OAuth state store is unavailable.' });
  }
  const url = qbo.authorizeUrl(process.env.URL, state);
  return { statusCode: 302, headers: { Location: url }, body: '' };
};
