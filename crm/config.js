// IgnorAInt CRM — runtime config
// ---------------------------------------------------------------------------
// Fill these in from your Supabase project's "Project Settings → API" page.
// Both values are SAFE to ship in client code (the anon key only grants the
// permissions allowed by your RLS policies — never paste the service_role key).
// ---------------------------------------------------------------------------

window.CRM_CONFIG = {
  SUPABASE_URL: "https://qphagqshsrdeefspxhss.supabase.co",

  // Supabase publishable key (safe to ship — RLS limits what it can do).
  SUPABASE_ANON_KEY: "sb_publishable_T4tRxxiXsxisiH4RH120UQ_JZPC7Ra-",

  // Default sender — only used to pre-fill new campaigns; can be overridden per campaign.
  DEFAULT_FROM_NAME:  "Addie Agarwal",
  DEFAULT_FROM_EMAIL: "addie@blog.ignoraint.com",
  DEFAULT_REPLY_TO:   "addie@blog.ignoraint.com",
};
