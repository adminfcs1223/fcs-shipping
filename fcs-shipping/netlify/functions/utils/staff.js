/* Verifies the caller is a signed-in FCS staff member.
   The admin pages send their Supabase access token as `Authorization: Bearer <token>`;
   we ask Supabase (as that user) whether is_staff() returns true. */

async function requireStaff(event) {
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { ok: false, error: 'Sign in required' };
  if (!process.env.SUPABASE_URL) return { ok: false, error: 'Supabase not configured' };

  try {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/rpc/is_staff`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) return { ok: false, error: 'Sign in required' };
    const isStaff = await res.json();
    return isStaff === true ? { ok: true } : { ok: false, error: 'Staff access only' };
  } catch (e) {
    return { ok: false, error: 'Could not verify staff access' };
  }
}

module.exports = { requireStaff };
