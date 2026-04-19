// IgnorAInt CRM — runtime config
// ---------------------------------------------------------------------------
// Fill these in from your Supabase project's "Project Settings → API" page.
// Both values are SAFE to ship in client code (the anon key only grants the
// permissions allowed by your RLS policies — never paste the service_role key).
// ---------------------------------------------------------------------------

window.CRM_CONFIG = {
  // e.g. "https://xxxxxxxxxxxxxxxx.supabase.co"
  SUPABASE_URL: "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE",

  // e.g. "eyJhbGci...." (the long anon/public key)
  SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_KEY_HERE",

  // Default sender — only used to pre-fill new campaigns; can be overridden per campaign.
  DEFAULT_FROM_NAME:  "Addie Agarwal",
  DEFAULT_FROM_EMAIL: "addie@blog.ignoraint.com",
  DEFAULT_REPLY_TO:   "addie@blog.ignoraint.com",
};
