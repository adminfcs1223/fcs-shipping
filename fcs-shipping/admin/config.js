/* Supabase connection for the staff dashboard.
   These two values come from Supabase → Project Settings → API.
   The "anon public" key is SAFE to publish (access is controlled by
   Row Level Security + staff logins). NEVER put the service_role key here. */
window.ADMIN_CONFIG = {
  SUPABASE_URL: 'https://tgjrqmapaqrrdgpjssjl.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_lQBAvo-uFaO3gxlO_eHVUg_oynN3LHv',
};
