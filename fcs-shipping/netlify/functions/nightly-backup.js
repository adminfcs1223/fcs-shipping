/* Nightly backup — runs on Netlify's scheduler (see netlify.toml: 05:00 UTC = 1 AM New York).
   1. Copies every FCS record (settings, pricing lists, customers, orders, tombstones,
      shipments, pickups, history) into ONE snapshot row: settings key fcs:backup:YYYY-MM-DD
   2. Keeps the newest 30 snapshots, deletes older ones
   3. E-mails the snapshot as a JSON attachment (BACKUP_EMAIL_TO, default derekh@fcsshipping.com)
   The admin site lists these under Settings → Nightly backups (download / restore). */

const { sb, supabaseConfigured } = require('./utils/shared');

const KEYS = {
  'fcs:settings': 'settings', 'fcs:v2': 'v2', 'fcs:customers': 'customers', 'fcs:orders2': 'orders',
  'fcs:gone': 'gone', 'fcs:shipments': 'shipments', 'fcs:pickups': 'pickups', 'fcs:log': 'log', 'pricing': 'pricing',
};
const KEEP = 30;

function nyDate() {
  /* today's date in New York, as YYYY-MM-DD */
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

exports.handler = async () => {
  if (!supabaseConfigured()) return { statusCode: 503, body: 'Supabase not configured' };
  const stamp = nyDate();
  const key = 'fcs:backup:' + stamp;
  try {
    /* 1. read every record */
    const rows = await sb(`settings?select=key,value,updated_at&key=in.(${Object.keys(KEYS).map(encodeURIComponent).join(',')})`);
    const snap = { at: new Date().toISOString(), by: 'nightly', stamp };
    (rows || []).forEach((r) => { snap[KEYS[r.key]] = r.value; });
    const orders = Array.isArray(snap.orders) ? snap.orders : [];
    if (!orders.length && !(rows || []).length) throw new Error('nothing to back up — read returned no rows');

    /* 2. store the snapshot (idempotent for the day) */
    await sb('settings', { method: 'POST', prefer: 'resolution=merge-duplicates',
      body: { key, value: snap, updated_at: new Date().toISOString() } });

    /* 3. prune to the newest KEEP snapshots */
    const all = await sb(`settings?select=key&key=like.fcs:backup:*&order=key.desc`);
    const old = (all || []).map((r) => r.key).slice(KEEP);
    for (const k of old) { try { await sb(`settings?key=eq.${encodeURIComponent(k)}`, { method: 'DELETE' }); } catch (e) { console.error('prune', k, e.message); } }

    /* 4. leave a line in the site's History */
    try {
      const lg = await sb(`settings?key=eq.fcs:log&select=value`);
      const log = (lg && lg[0] && Array.isArray(lg[0].value)) ? lg[0].value : [];
      log.push({ at: new Date().toISOString(), by: 'nightly job', act: 'backup', inv: '', note: `${orders.length} orders · snapshot ${stamp}` });
      await sb('settings', { method: 'POST', prefer: 'resolution=merge-duplicates',
        body: { key: 'fcs:log', value: log.slice(-300), updated_at: new Date().toISOString() } });
    } catch (e) { console.error('log', e.message); }

    /* 5. e-mail it */
    let mailed = false, mailErr = '';
    if (process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('PLACEHOLDER')) {
      const to = (process.env.BACKUP_EMAIL_TO || 'derekh@fcsshipping.com').split(',').map((s) => s.trim()).filter(Boolean);
      const json = JSON.stringify(snap);
      const total = orders.reduce((s, o) => s + (o.items || []).reduce((a, it) => {
        if (it.amount !== '' && it.amount != null) return a + (Number(String(it.amount).replace(/[^0-9.\-]/g, '')) || 0);
        const q = parseFloat(it.qty), p = parseFloat(String(it.price).replace(/[^0-9.\-]/g, ''));
        return a + ((isFinite(q) && isFinite(p)) ? q * p : 0);
      }, 0), 0);
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111">
        <h2 style="margin:0 0 6px">FCS nightly backup — ${stamp}</h2>
        <p style="margin:0 0 12px;color:#555">Attached is the complete snapshot (JSON). It can be restored from Settings → Nightly backups, or by Restore in the sidebar.</p>
        <table style="font-size:14px;border-collapse:collapse">
          <tr><td style="padding:4px 12px 4px 0;color:#555">Orders / receipts</td><td><b>${orders.length}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Total billed (all time)</td><td><b>$${total.toFixed(2)}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Shipments</td><td><b>${Array.isArray(snap.shipments) ? snap.shipments.length : 0}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Pickup days</td><td><b>${snap.pickups && typeof snap.pickups === 'object' ? Object.keys(snap.pickups).length : 0}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Next B/L number</td><td><b>${snap.settings && snap.settings.next ? snap.settings.next : '?'}</b></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">Snapshot size</td><td><b>${(json.length / 1024).toFixed(0)} KB</b></td></tr>
        </table>
        <p style="margin:14px 0 0;font-size:12px;color:#777">Snapshots kept in the database: newest ${KEEP}. This one is stored as ${key}.</p></div>`;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.QUOTE_EMAIL_FROM || 'FCS Shipping <onboarding@resend.dev>',
            to, subject: `FCS nightly backup — ${stamp} — ${orders.length} orders`, html,
            attachments: [{ filename: `fcs-backup-${stamp}.json`, content: Buffer.from(json).toString('base64') }],
          }),
        });
        mailed = res.ok; if (!res.ok) mailErr = await res.text();
      } catch (e) { mailErr = e.message; }
    } else mailErr = 'RESEND_API_KEY not set';
    console.log(`backup ${key}: ${orders.length} orders, pruned ${old.length}, mailed=${mailed} ${mailErr}`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, key, orders: orders.length, pruned: old.length, mailed, mailErr }) };
  } catch (e) {
    console.error('nightly backup failed:', e.message);
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: e.message }) };
  }
};
