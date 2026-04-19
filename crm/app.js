// IgnorAInt CRM — vanilla JS SPA
// ---------------------------------------------------------------------------
// Hash-routed single page app. Everything talks to Supabase via @supabase/supabase-js.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cfg = window.CRM_CONFIG || {};
if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_URL.startsWith("PASTE")) {
  document.body.innerHTML = `
    <div style="max-width:560px;margin:80px auto;padding:32px;font-family:Inter,sans-serif;line-height:1.6;">
      <h1 style="font-family:Fraunces,serif;color:#1F3A5F;">Config missing</h1>
      <p>Open <code>crm/config.js</code> and paste your Supabase project URL + anon key, then redeploy.</p>
      <p style="color:#3C5679;">See <a href="../SETUP.md">SETUP.md</a> for step-by-step.</p>
    </div>`;
  throw new Error("CRM_CONFIG not set");
}

const sb = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------
let currentUser = null;
let currentRoute = "dashboard";
const routes = ["dashboard", "contacts", "lists", "campaigns"];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.appendChild(typeof kid === "string" ? document.createTextNode(kid) : kid);
  }
  return n;
};

function toast(msg, kind = "info") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast " + (kind === "error" ? "error" : kind === "success" ? "success" : "");
  setTimeout(() => t.classList.add("hidden"), 4200);
  t.classList.remove("hidden");
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c])); }
function fmtDate(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
function fmtDateTime(s) {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function confirmDialog(msg) { return window.confirm(msg); }
function openModal(node) {
  const backdrop = el("div", { class: "modal-backdrop", onClick: (e) => { if (e.target === backdrop) close(); } });
  const modal = el("div", { class: "modal" });
  modal.appendChild(node);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  return { close, modal };
}

async function apiCall(functionName, body) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { toast("Session expired. Please sign in again.", "error"); showLogin(); throw new Error("no session"); }
  const res = await fetch(`${cfg.SUPABASE_URL}/functions/v1/${functionName}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${session.access_token}`,
      "apikey": cfg.SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!res.ok) {
    // Surface whichever field is populated: our function uses `error`,
    // the Supabase Functions runtime uses `message` (with `code`).
    const msg = data.error || data.message || (data.code ? `${data.code}: ${data.message || ""}` : "") || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Auth flow
// ---------------------------------------------------------------------------
function showLogin()  { $("#view-login").classList.remove("hidden"); $("#view-app").classList.add("hidden"); }
function showApp()    { $("#view-login").classList.add("hidden");    $("#view-app").classList.remove("hidden"); }

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#login-email").value.trim();
  const password = $("#login-password").value;
  const btn = $("#login-submit");
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Signing in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  btn.disabled = false; btn.textContent = "Sign in";
  if (error) { toast(error.message, "error"); return; }
  currentUser = data.user;
  await onSignedIn();
});

$("#signout").addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUser = null;
  showLogin();
});

async function onSignedIn() {
  $("#user-email").textContent = currentUser.email;
  showApp();
  wireNav();
  handleRoute();
}

function wireNav() {
  $$(".nav-item").forEach((a) => {
    a.addEventListener("click", (e) => {
      const r = a.dataset.route;
      if (routes.includes(r)) {
        e.preventDefault();
        location.hash = "#" + r;
      }
    });
  });
  window.addEventListener("hashchange", handleRoute);
}

function handleRoute() {
  const r = (location.hash || "#dashboard").replace(/^#/, "").split("/")[0];
  const route = routes.includes(r) ? r : "dashboard";
  currentRoute = route;
  $$(".nav-item").forEach((a) => a.classList.toggle("active", a.dataset.route === route));
  const view = { dashboard: renderDashboard, contacts: renderContacts, lists: renderLists, campaigns: renderCampaigns }[route];
  view();
}

// ---------------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------------
async function renderDashboard() {
  const main = $("#main"); main.innerHTML = "";
  main.appendChild(el("div", { class: "page-head" }, el("div", {}, el("h1", {}, "Dashboard"), el("p", { class: "muted" }, "Your CRM at a glance."))));

  const grid = el("div", { class: "kpi-grid" });
  const kpis = [
    { label: "Contacts",          key: "contacts" },
    { label: "Subscribed",        key: "subscribed" },
    { label: "Lists",             key: "lists" },
    { label: "Campaigns sent",    key: "sent" },
  ];
  kpis.forEach((k) => grid.appendChild(el("div", { class: "kpi", id: `kpi-${k.key}` },
    el("div", { class: "label" }, k.label),
    el("div", { class: "value" }, "…"))));
  main.appendChild(grid);

  const recent = el("div", { class: "card" },
    el("h2", {}, "Recent campaigns"),
    el("div", { id: "recent-campaigns" }, el("p", { class: "muted" }, "Loading…")));
  main.appendChild(recent);

  // Parallel load
  const [contacts, lists, campaigns] = await Promise.all([
    sb.from("contacts").select("id, subscribed", { count: "exact" }),
    sb.from("lists").select("id", { count: "exact" }),
    sb.from("campaign_summary").select("*").order("created_at", { ascending: false }).limit(10),
  ]);

  $("#kpi-contacts   .value").textContent = contacts.count ?? 0;
  $("#kpi-subscribed .value").textContent = (contacts.data ?? []).filter((c) => c.subscribed).length;
  $("#kpi-lists      .value").textContent = lists.count ?? 0;
  $("#kpi-sent       .value").textContent = (campaigns.data ?? []).filter((c) => c.status === "sent").length;

  const rc = $("#recent-campaigns");
  if (!campaigns.data || campaigns.data.length === 0) {
    rc.innerHTML = '<p class="muted">No campaigns yet. Head to <a href="#campaigns">Campaigns</a> to draft one.</p>';
  } else {
    const tbl = el("table", {});
    tbl.appendChild(el("thead", {}, el("tr", {},
      el("th", {}, "Name"), el("th", {}, "Status"), el("th", {}, "List"), el("th", {}, "Sent"), el("th", {}, "Failed"), el("th", {}, "When"))));
    const tb = el("tbody", {});
    campaigns.data.forEach((c) => {
      const tr = el("tr", { class: "row-clickable", onClick: () => { location.hash = `#campaigns/${c.id}`; } },
        el("td", {}, c.name),
        el("td", {}, el("span", { class: `pill pill-${c.status}` }, c.status)),
        el("td", {}, c.list_name ?? "—"),
        el("td", {}, String(c.sent_count ?? 0)),
        el("td", {}, String(c.failed_count ?? 0)),
        el("td", {}, fmtDateTime(c.sent_at || c.created_at)),
      );
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    rc.innerHTML = ""; rc.appendChild(tbl);
  }
}

// ---------------------------------------------------------------------------
// CONTACTS
// ---------------------------------------------------------------------------
async function renderContacts() {
  const main = $("#main"); main.innerHTML = "";
  main.appendChild(el("div", { class: "page-head" },
    el("div", {}, el("h1", {}, "Contacts"), el("p", { class: "muted" }, "Everyone you can email.")),
    el("div", { class: "actions" },
      el("button", { class: "btn-ghost", onClick: openZoomImport }, "Import Zoom CSV"),
      el("button", { class: "btn-ghost", onClick: openCsvImport }, "Import generic CSV"),
      el("button", { class: "btn-ember", onClick: openNewContact }, "+ New contact"),
    ),
  ));

  // --- Filters row ---
  const search      = el("input", { type: "text", placeholder: "Search email, first name, last name, phone…" });
  const sourceSel   = el("select", {});
  const statusSel   = el("select", {});
  sourceSel.appendChild(el("option", { value: "" }, "All sources"));
  ["subscribed", "unsubscribed"].forEach(() => {}); // placeholder, populated below
  [["", "All statuses"], ["subscribed", "Subscribed only"], ["unsubscribed", "Unsubscribed only"]].forEach(([v, l]) => {
    statusSel.appendChild(el("option", { value: v }, l));
  });

  const filterBar = el("div", { style: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1fr) 200px 200px",
    gap: "12px",
    marginBottom: "16px",
  } }, search, sourceSel, statusSel);
  // Collapse to one column on narrow screens
  const mq = window.matchMedia("(max-width: 800px)");
  const applyMq = () => { filterBar.style.gridTemplateColumns = mq.matches ? "1fr" : "minmax(220px, 1fr) 200px 200px"; };
  applyMq(); mq.addEventListener("change", applyMq);
  main.appendChild(filterBar);

  // --- Bulk actions bar (hidden until a row is selected) ---
  const bulkBar = el("div", {
    style: {
      display: "none",
      alignItems: "center",
      gap: "12px",
      padding: "10px 14px",
      marginBottom: "12px",
      background: "rgba(201,122,72,0.08)",
      border: "1px solid rgba(201,122,72,0.25)",
      borderRadius: "12px",
      flexWrap: "wrap",
    },
  });
  const bulkCount   = el("span", { style: { fontWeight: "600", color: "var(--ink)" } }, "0 selected");
  const bulkDelBtn  = el("button", { class: "btn-danger btn-sm" }, "Delete selected");
  const bulkClrBtn  = el("button", { class: "btn-ghost btn-sm" }, "Clear");
  bulkBar.append(bulkCount, bulkDelBtn, bulkClrBtn);
  main.appendChild(bulkBar);

  // --- Card holding table + 'delete all matching filters' footer ---
  const tableHost = el("div", { id: "contacts-table" }, el("p", { class: "muted" }, "Loading…"));
  const footer    = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px", flexWrap: "wrap", gap: "8px" } });
  const countEl   = el("span", { class: "muted", style: { fontSize: "13px" } }, "");
  const delAllBtn = el("button", { class: "btn-danger btn-sm" }, "Delete all matching filters");
  footer.append(countEl, delAllBtn);
  const card = el("div", { class: "card" }, tableHost, footer);
  main.appendChild(card);

  // --- State ---
  let allRows = [];        // latest fetched rows (pre-filter)
  let filtered = [];       // latest filtered view
  const selected = new Set();

  function updateBulkBar() {
    if (selected.size === 0) { bulkBar.style.display = "none"; return; }
    bulkBar.style.display = "flex";
    bulkCount.textContent = `${selected.size} selected`;
  }

  function applyFilters(rows) {
    const q = search.value.trim().toLowerCase();
    const src = sourceSel.value;
    const st  = statusSel.value;
    return rows.filter((c) => {
      if (q) {
        const hay = [c.email, c.first_name, c.last_name, c.phone].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (src && (c.source || "") !== src) return false;
      if (st === "subscribed"   && !c.subscribed) return false;
      if (st === "unsubscribed" &&  c.subscribed) return false;
      return true;
    });
  }

  function renderTable() {
    filtered = applyFilters(allRows);

    if (filtered.length === 0) {
      const anyFilter = search.value || sourceSel.value || statusSel.value;
      tableHost.innerHTML = `<div class="empty-state"><h2>No contacts${anyFilter ? " match your filters" : " yet"}</h2><p>${anyFilter ? "" : "Import a Zoom CSV to get started."}</p></div>`;
      countEl.textContent = "";
      delAllBtn.style.display = "none";
      return;
    }

    const anyFilter = !!(search.value || sourceSel.value || statusSel.value);
    countEl.textContent = `${filtered.length} contact${filtered.length === 1 ? "" : "s"}${anyFilter ? " match your filters" : ""}`;
    delAllBtn.style.display = anyFilter ? "inline-block" : "none";

    tableHost.innerHTML = "";
    const tbl = el("table", {});

    // Select-all header checkbox
    const selAll = el("input", { type: "checkbox", title: "Select all on this page" });
    selAll.checked = filtered.length > 0 && filtered.every((c) => selected.has(c.id));
    selAll.addEventListener("change", () => {
      if (selAll.checked) filtered.forEach((c) => selected.add(c.id));
      else                filtered.forEach((c) => selected.delete(c.id));
      renderTable();
      updateBulkBar();
    });

    tbl.appendChild(el("thead", {}, el("tr", {},
      el("th", { style: { width: "36px" } }, selAll),
      el("th", {}, "Email"),
      el("th", {}, "Name"),
      el("th", {}, "Phone"),
      el("th", {}, "Source"),
      el("th", {}, "Status"),
      el("th", {}, "Added"),
      el("th", {}, ""),
    )));

    const tb = el("tbody", {});
    filtered.forEach((c) => {
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
      const cb = el("input", { type: "checkbox" });
      cb.checked = selected.has(c.id);
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(c.id); else selected.delete(c.id);
        updateBulkBar();
      });

      const phoneCell = c.phone
        ? el("a", { href: `tel:${c.phone}`, style: { color: "var(--ink)" } }, c.phone)
        : el("span", { class: "muted" }, "—");

      tb.appendChild(el("tr", {},
        el("td", {}, cb),
        el("td", {}, c.email),
        el("td", {}, name),
        el("td", {}, phoneCell),
        el("td", {}, c.source || "—"),
        el("td", {}, el("span", { class: `pill pill-${c.subscribed ? "sub" : "unsub"}` }, c.subscribed ? "Subscribed" : "Unsubscribed")),
        el("td", {}, fmtDate(c.created_at)),
        el("td", {},
          el("button", { class: "btn-ghost btn-sm", onClick: () => editContact(c).then(load) }, "Edit"),
          " ",
          el("button", { class: "btn-danger btn-sm", onClick: async () => {
            if (!confirmDialog(`Delete ${c.email}? This also removes them from all lists.`)) return;
            const { error } = await sb.from("contacts").delete().eq("id", c.id);
            if (error) toast(error.message, "error"); else { toast("Deleted.", "success"); selected.delete(c.id); updateBulkBar(); load(); }
          }}, "Delete"),
        ),
      ));
    });
    tbl.appendChild(tb);
    tableHost.appendChild(tbl);
  }

  async function load() {
    const { data, error } = await sb.from("contacts").select("*").order("created_at", { ascending: false }).limit(2000);
    if (error) { tableHost.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`; return; }
    allRows = data || [];

    // Populate sources dropdown from what actually exists (preserve current selection)
    const prevSrc = sourceSel.value;
    while (sourceSel.options.length > 1) sourceSel.remove(1);
    const sources = [...new Set(allRows.map((c) => c.source).filter(Boolean))].sort();
    sources.forEach((s) => sourceSel.appendChild(el("option", { value: s }, s)));
    if (prevSrc) sourceSel.value = prevSrc;

    // Drop any selected ids that have disappeared
    const existing = new Set(allRows.map((c) => c.id));
    for (const id of [...selected]) if (!existing.has(id)) selected.delete(id);

    renderTable();
    updateBulkBar();
  }

  // --- Wire up bulk actions ---
  bulkClrBtn.addEventListener("click", () => { selected.clear(); updateBulkBar(); renderTable(); });

  bulkDelBtn.addEventListener("click", async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirmDialog(`Delete ${ids.length} contact${ids.length === 1 ? "" : "s"}? They'll be removed from all lists too. This cannot be undone.`)) return;
    bulkDelBtn.disabled = true; bulkDelBtn.innerHTML = '<span class="spinner"></span> Deleting…';
    const { error } = await sb.from("contacts").delete().in("id", ids);
    bulkDelBtn.disabled = false; bulkDelBtn.textContent = "Delete selected";
    if (error) { toast(error.message, "error"); return; }
    toast(`Deleted ${ids.length} contact${ids.length === 1 ? "" : "s"}.`, "success");
    selected.clear();
    updateBulkBar();
    load();
  });

  delAllBtn.addEventListener("click", async () => {
    if (!filtered.length) return;
    const label = `all ${filtered.length} contact${filtered.length === 1 ? "" : "s"} matching your current filters`;
    if (!confirmDialog(`Delete ${label}? This cannot be undone.`)) return;
    const ids = filtered.map((c) => c.id);
    delAllBtn.disabled = true; delAllBtn.innerHTML = '<span class="spinner"></span> Deleting…';
    const { error } = await sb.from("contacts").delete().in("id", ids);
    delAllBtn.disabled = false; delAllBtn.textContent = "Delete all matching filters";
    if (error) { toast(error.message, "error"); return; }
    toast(`Deleted ${ids.length} contact${ids.length === 1 ? "" : "s"}.`, "success");
    selected.clear();
    updateBulkBar();
    load();
  });

  // --- Wire up filter inputs ---
  let searchT;
  search.addEventListener("input", () => { clearTimeout(searchT); searchT = setTimeout(renderTable, 150); });
  sourceSel.addEventListener("change", renderTable);
  statusSel.addEventListener("change", renderTable);

  load();
}

function openNewContact() {
  const form = el("div", {}, el("h2", {}, "New contact"));
  const email = el("input", { type: "email", required: true });
  const first = el("input", { type: "text" });
  const last  = el("input", { type: "text" });
  const phone = el("input", { type: "tel", placeholder: "+1 (555) 123-4567" });
  const source = el("input", { type: "text", placeholder: "e.g. manual, referral" });
  form.appendChild(el("div", { class: "field" }, el("label", {}, "Email *"), email));
  form.appendChild(el("div", { class: "row row-2" },
    el("div", { class: "field" }, el("label", {}, "First name"), first),
    el("div", { class: "field" }, el("label", {}, "Last name"), last)));
  form.appendChild(el("div", { class: "row row-2" },
    el("div", { class: "field" }, el("label", {}, "Phone"), phone),
    el("div", { class: "field" }, el("label", {}, "Source"), source)));

  const { close } = openModal(form);
  form.appendChild(el("div", { class: "modal-actions" },
    el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
    el("button", { class: "btn-ember", onClick: async () => {
      if (!email.value) { toast("Email required", "error"); return; }
      const { error } = await sb.from("contacts").insert({
        email: email.value.trim().toLowerCase(),
        first_name: first.value.trim() || null,
        last_name: last.value.trim() || null,
        phone: phone.value.trim() || null,
        source: source.value.trim() || "manual",
      });
      if (error) toast(error.message, "error"); else { toast("Contact added.", "success"); close(); renderContacts(); }
    }}, "Save"),
  ));
}

async function editContact(c) {
  return new Promise((resolve) => {
    const form = el("div", {}, el("h2", {}, "Edit contact"));
    const email = el("input", { type: "email", value: c.email });
    const first = el("input", { type: "text", value: c.first_name || "" });
    const last  = el("input", { type: "text", value: c.last_name || "" });
    const phone = el("input", { type: "tel", value: c.phone || "", placeholder: "+1 (555) 123-4567" });
    const source = el("input", { type: "text", value: c.source || "" });
    const sub = el("input", { type: "checkbox" }); sub.checked = c.subscribed;
    form.appendChild(el("div", { class: "field" }, el("label", {}, "Email"), email));
    form.appendChild(el("div", { class: "row row-2" },
      el("div", { class: "field" }, el("label", {}, "First name"), first),
      el("div", { class: "field" }, el("label", {}, "Last name"), last)));
    form.appendChild(el("div", { class: "row row-2" },
      el("div", { class: "field" }, el("label", {}, "Phone"), phone),
      el("div", { class: "field" }, el("label", {}, "Source"), source)));
    form.appendChild(el("div", { class: "field" }, el("label", { style: { display: "flex", alignItems: "center", gap: "8px" } }, sub, "Subscribed")));

    const { close } = openModal(form);
    form.appendChild(el("div", { class: "modal-actions" },
      el("button", { class: "btn-ghost", onClick: () => { close(); resolve(); } }, "Cancel"),
      el("button", { class: "btn-ember", onClick: async () => {
        const { error } = await sb.from("contacts").update({
          email: email.value.trim().toLowerCase(),
          first_name: first.value.trim() || null,
          last_name: last.value.trim() || null,
          phone: phone.value.trim() || null,
          source: source.value.trim() || null,
          subscribed: sub.checked,
        }).eq("id", c.id);
        if (error) toast(error.message, "error"); else { toast("Saved.", "success"); close(); resolve(); }
      }}, "Save"),
    ));
  });
}

// ---------------------------------------------------------------------------
// CSV IMPORT (Zoom + generic)
// ---------------------------------------------------------------------------
// Basic RFC 4180 CSV parser (handles quoted fields with commas/newlines).
function parseCSV(text) {
  const rows = [];
  let i = 0, field = "", row = [], inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === "\"") {
        if (text[i + 1] === "\"") { field += "\""; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++;
    } else {
      if (c === "\"") { inQuotes = true; i++; continue; }
      if (c === ",")  { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length && r.some((v) => v !== ""));
}

function openZoomImport() {
  openCsvImport({ zoom: true });
}

function openCsvImport({ zoom = false } = {}) {
  const box = el("div", {});
  box.appendChild(el("h2", {}, zoom ? "Import Zoom registrations" : "Import contacts from CSV"));
  box.appendChild(el("p", { class: "muted" }, zoom
    ? "Upload the registration report CSV exported from Zoom. We'll detect First Name, Last Name, Email, and Phone columns — Zoom sometimes includes a preamble above the header, which we'll skip."
    : "Upload a CSV with columns: email (required), first_name, last_name, phone, source."));

  const fileInput = el("input", { type: "file", accept: ".csv,text/csv" });
  box.appendChild(el("div", { class: "field" }, el("label", {}, "CSV file"), fileInput));

  const listSel = el("select", {});
  listSel.appendChild(el("option", { value: "" }, "— Don't add to a list —"));
  box.appendChild(el("div", { class: "field" }, el("label", {}, "Add imported contacts to list"), listSel));
  sb.from("lists").select("id, name").order("name").then(({ data }) => {
    (data || []).forEach((l) => listSel.appendChild(el("option", { value: l.id }, l.name)));
  });

  const sourceInput = el("input", { type: "text", value: zoom ? "zoom" : "csv" });
  box.appendChild(el("div", { class: "field" }, el("label", {}, "Tag these contacts with source"), sourceInput));

  const preview = el("div", { class: "muted", style: { marginTop: "8px" } });
  box.appendChild(preview);

  let parsedContacts = [];

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0]; if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (rows.length === 0) { preview.textContent = "Empty file."; parsedContacts = []; return; }

    // Find header row (the one containing an "email" column)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      if (rows[i].some((c) => /^\s*email\s*$/i.test(c) || /email\s*address/i.test(c))) { headerIdx = i; break; }
    }
    if (headerIdx === -1) { preview.innerHTML = '<span style="color:var(--danger)">No email column found in the first 10 rows.</span>'; parsedContacts = []; return; }

    const header = rows[headerIdx].map((h) => h.trim().toLowerCase());
    const idxEmail = header.findIndex((h) => h === "email" || h.includes("email address"));
    const idxFirst = header.findIndex((h) => h === "first_name" || h === "first name");
    const idxLast  = header.findIndex((h) => h === "last_name"  || h === "last name");
    const idxPhone = header.findIndex((h) => h === "phone" || h === "phone number" || h === "mobile" || h === "cell" || h === "tel");

    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const emailVal = (r[idxEmail] || "").trim().toLowerCase();
      if (!emailVal || !emailVal.includes("@")) continue;
      out.push({
        email: emailVal,
        first_name: idxFirst >= 0 ? (r[idxFirst] || "").trim() || null : null,
        last_name:  idxLast  >= 0 ? (r[idxLast]  || "").trim() || null : null,
        phone:      idxPhone >= 0 ? (r[idxPhone] || "").trim() || null : null,
        source: sourceInput.value.trim() || (zoom ? "zoom" : "csv"),
      });
    }
    parsedContacts = out;
    preview.innerHTML = `Parsed <strong>${out.length}</strong> contacts. Ready to import.`;
  });

  const { close } = openModal(box);
  box.appendChild(el("div", { class: "modal-actions" },
    el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
    el("button", { class: "btn-ember", id: "do-import", onClick: async (e) => {
      if (!parsedContacts.length) { toast("Nothing to import — pick a CSV.", "error"); return; }
      const btn = e.currentTarget;
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Importing…';

      // Upsert by email
      const { data: inserted, error } = await sb.from("contacts")
        .upsert(parsedContacts, { onConflict: "email", ignoreDuplicates: false })
        .select("id, email");
      if (error) { toast(error.message, "error"); btn.disabled = false; btn.textContent = "Import"; return; }

      if (listSel.value) {
        const links = (inserted || []).map((c) => ({ list_id: listSel.value, contact_id: c.id }));
        if (links.length) {
          const { error: linkErr } = await sb.from("list_contacts").upsert(links, { onConflict: "list_id,contact_id" });
          if (linkErr) { toast("Imported, but couldn't add to list: " + linkErr.message, "error"); }
        }
      }
      toast(`Imported ${inserted.length} contacts.`, "success");
      close();
      renderContacts();
    }}, "Import"),
  ));
}

// ---------------------------------------------------------------------------
// LISTS
// ---------------------------------------------------------------------------
async function renderLists() {
  const main = $("#main"); main.innerHTML = "";
  main.appendChild(el("div", { class: "page-head" },
    el("div", {}, el("h1", {}, "Lists"), el("p", { class: "muted" }, "Grouped audiences for campaigns.")),
    el("div", { class: "actions" }, el("button", { class: "btn-ember", onClick: openNewList }, "+ New list")),
  ));

  const card = el("div", { class: "card" }, el("div", { id: "lists-table" }, el("p", { class: "muted" }, "Loading…")));
  main.appendChild(card);

  async function load() {
    const { data, error } = await sb.from("lists").select("*").order("created_at", { ascending: false });
    const host = $("#lists-table");
    if (error) { host.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`; return; }
    if (!data.length) { host.innerHTML = `<div class="empty-state"><h2>No lists yet</h2><p>Create one, then assign contacts to it.</p></div>`; return; }

    // Fetch subscribed counts in parallel
    const counts = await Promise.all(data.map((l) => sb.rpc("list_subscribed_count", { p_list_id: l.id })));
    host.innerHTML = "";
    const tbl = el("table", {});
    tbl.appendChild(el("thead", {}, el("tr", {}, el("th", {}, "Name"), el("th", {}, "Subscribed"), el("th", {}, "Created"), el("th", {}, ""))));
    const tb = el("tbody", {});
    data.forEach((l, i) => {
      tb.appendChild(el("tr", {},
        el("td", {}, l.name),
        el("td", {}, String(counts[i].data ?? 0)),
        el("td", {}, fmtDate(l.created_at)),
        el("td", {},
          el("button", { class: "btn-ghost btn-sm", onClick: () => openListDetail(l) }, "View"),
          " ",
          el("button", { class: "btn-danger btn-sm", onClick: async () => {
            if (!confirmDialog(`Delete list "${l.name}"? Contacts aren't deleted.`)) return;
            const { error } = await sb.from("lists").delete().eq("id", l.id);
            if (error) toast(error.message, "error"); else { toast("Deleted.", "success"); load(); }
          }}, "Delete"),
        ),
      ));
    });
    tbl.appendChild(tb);
    host.appendChild(tbl);
  }
  load();
}

function openNewList() {
  const form = el("div", {}, el("h2", {}, "New list"));
  const name = el("input", { type: "text" });
  const desc = el("textarea", {});
  form.appendChild(el("div", { class: "field" }, el("label", {}, "Name"), name));
  form.appendChild(el("div", { class: "field" }, el("label", {}, "Description"), desc));

  const { close } = openModal(form);
  form.appendChild(el("div", { class: "modal-actions" },
    el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
    el("button", { class: "btn-ember", onClick: async () => {
      if (!name.value.trim()) { toast("Name required.", "error"); return; }
      const { error } = await sb.from("lists").insert({ name: name.value.trim(), description: desc.value.trim() || null });
      if (error) toast(error.message, "error"); else { toast("List created.", "success"); close(); renderLists(); }
    }}, "Save"),
  ));
}

async function openListDetail(l) {
  const box = el("div", {});
  box.appendChild(el("h2", {}, l.name));
  box.appendChild(el("p", { class: "muted" }, l.description || "No description."));

  const actions = el("div", { style: { display: "flex", gap: "10px", margin: "12px 0", flexWrap: "wrap" } });
  const addBtn = el("button", { class: "btn-ember btn-sm", onClick: () => openAddToList(l.id, load) }, "+ Add contacts");
  actions.appendChild(addBtn);
  box.appendChild(actions);

  const table = el("div", {}, el("p", { class: "muted" }, "Loading…"));
  box.appendChild(table);

  const { close } = openModal(box);
  box.appendChild(el("div", { class: "modal-actions" }, el("button", { class: "btn-ghost", onClick: close }, "Close")));

  async function load() {
    const { data, error } = await sb.from("list_contacts")
      .select("added_at, contacts:contacts!inner(id, email, first_name, last_name, subscribed)")
      .eq("list_id", l.id);
    if (error) { table.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`; return; }
    const rows = data || [];
    if (!rows.length) { table.innerHTML = `<p class="muted">No contacts in this list yet.</p>`; return; }
    table.innerHTML = "";
    const tbl = el("table", {});
    tbl.appendChild(el("thead", {}, el("tr", {}, el("th", {}, "Email"), el("th", {}, "Name"), el("th", {}, "Status"), el("th", {}, ""))));
    const tb = el("tbody", {});
    rows.forEach((r) => {
      const c = r.contacts;
      const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "—";
      tb.appendChild(el("tr", {},
        el("td", {}, c.email),
        el("td", {}, name),
        el("td", {}, el("span", { class: `pill pill-${c.subscribed ? "sub" : "unsub"}` }, c.subscribed ? "Subscribed" : "Unsubscribed")),
        el("td", {},
          el("button", { class: "btn-danger btn-sm", onClick: async () => {
            const { error: e } = await sb.from("list_contacts").delete().eq("list_id", l.id).eq("contact_id", c.id);
            if (e) toast(e.message, "error"); else { toast("Removed.", "success"); load(); }
          }}, "Remove"),
        ),
      ));
    });
    tbl.appendChild(tb);
    table.appendChild(tbl);
  }
  load();
}

function openAddToList(listId, onDone) {
  const box = el("div", {}, el("h2", {}, "Add contacts to list"));
  const search = el("input", { type: "text", placeholder: "Search email / name…" });
  const results = el("div", { style: { maxHeight: "320px", overflowY: "auto", marginTop: "10px", border: "1px solid var(--border-1)", borderRadius: "10px" } });
  box.appendChild(el("div", { class: "field" }, el("label", {}, "Find contacts"), search));
  box.appendChild(results);

  const selected = new Set();
  const summary = el("p", { class: "muted", style: { marginTop: "10px" } }, "0 selected");
  box.appendChild(summary);

  async function load() {
    const q = search.value.trim().toLowerCase();
    let req = sb.from("contacts").select("id, email, first_name, last_name, subscribed").order("created_at", { ascending: false }).limit(100);
    if (q) req = req.or(`email.ilike.%${q}%,first_name.ilike.%${q}%,last_name.ilike.%${q}%`);
    const { data } = await req;
    results.innerHTML = "";
    (data || []).forEach((c) => {
      const row = el("label", { style: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderBottom: "1px solid var(--border-1)", cursor: "pointer" } });
      const cb = el("input", { type: "checkbox" });
      cb.checked = selected.has(c.id);
      cb.addEventListener("change", () => {
        if (cb.checked) selected.add(c.id); else selected.delete(c.id);
        summary.textContent = `${selected.size} selected`;
      });
      row.appendChild(cb);
      row.appendChild(el("div", {}, el("div", {}, c.email), el("div", { class: "muted", style: { fontSize: "12px" } }, [c.first_name, c.last_name].filter(Boolean).join(" ") || "—")));
      results.appendChild(row);
    });
  }
  search.addEventListener("input", () => { clearTimeout(search._t); search._t = setTimeout(load, 200); });
  load();

  const { close } = openModal(box);
  box.appendChild(el("div", { class: "modal-actions" },
    el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
    el("button", { class: "btn-ember", onClick: async () => {
      if (!selected.size) { toast("Select at least one.", "error"); return; }
      const rows = Array.from(selected).map((contact_id) => ({ list_id: listId, contact_id }));
      const { error } = await sb.from("list_contacts").upsert(rows, { onConflict: "list_id,contact_id" });
      if (error) toast(error.message, "error"); else { toast(`Added ${rows.length}.`, "success"); close(); onDone?.(); }
    }}, "Add"),
  ));
}

// ---------------------------------------------------------------------------
// CAMPAIGNS
// ---------------------------------------------------------------------------
async function renderCampaigns() {
  const hash = location.hash.replace(/^#/, "");
  const parts = hash.split("/");
  if (parts[1]) { renderCampaignEditor(parts[1]); return; }

  const main = $("#main"); main.innerHTML = "";
  main.appendChild(el("div", { class: "page-head" },
    el("div", {}, el("h1", {}, "Campaigns"), el("p", { class: "muted" }, "Drafts, schedules, and sends.")),
    el("div", { class: "actions" }, el("button", { class: "btn-ember", onClick: openNewCampaign }, "+ New campaign")),
  ));

  const card = el("div", { class: "card" }, el("div", { id: "camps-table" }, el("p", { class: "muted" }, "Loading…")));
  main.appendChild(card);

  const { data, error } = await sb.from("campaign_summary").select("*").order("created_at", { ascending: false });
  const host = $("#camps-table");
  if (error) { host.innerHTML = `<p class="muted">Error: ${esc(error.message)}</p>`; return; }
  if (!data.length) { host.innerHTML = `<div class="empty-state"><h2>No campaigns yet</h2><p>Start a draft — Claude will help write it in your voice.</p></div>`; return; }

  host.innerHTML = "";
  const tbl = el("table", {});
  tbl.appendChild(el("thead", {}, el("tr", {},
    el("th", {}, "Name"), el("th", {}, "Subject"), el("th", {}, "Status"), el("th", {}, "List"), el("th", {}, "Sent"), el("th", {}, "Updated"))));
  const tb = el("tbody", {});
  data.forEach((c) => {
    tb.appendChild(el("tr", { class: "row-clickable", onClick: () => { location.hash = `#campaigns/${c.id}`; } },
      el("td", {}, c.name),
      el("td", {}, c.subject || "—"),
      el("td", {}, el("span", { class: `pill pill-${c.status}` }, c.status)),
      el("td", {}, c.list_name || "—"),
      el("td", {}, String(c.sent_count ?? 0)),
      el("td", {}, fmtDateTime(c.sent_at || c.created_at)),
    ));
  });
  tbl.appendChild(tb);
  host.appendChild(tbl);
}

async function openNewCampaign() {
  const box = el("div", {}, el("h2", {}, "New campaign"));
  const name = el("input", { type: "text", placeholder: "Internal label, e.g. April 26 follow-up" });
  const listSel = el("select", {});
  listSel.appendChild(el("option", { value: "" }, "— Pick a list —"));
  const { data: lists } = await sb.from("lists").select("id, name").order("name");
  (lists || []).forEach((l) => listSel.appendChild(el("option", { value: l.id }, l.name)));

  box.appendChild(el("div", { class: "field" }, el("label", {}, "Campaign name"), name));
  box.appendChild(el("div", { class: "field" }, el("label", {}, "Recipient list"), listSel));

  const { close } = openModal(box);
  box.appendChild(el("div", { class: "modal-actions" },
    el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
    el("button", { class: "btn-ember", onClick: async () => {
      if (!name.value.trim()) { toast("Name required.", "error"); return; }
      const { data, error } = await sb.from("campaigns").insert({
        name: name.value.trim(),
        list_id: listSel.value || null,
        from_name: cfg.DEFAULT_FROM_NAME,
        from_email: cfg.DEFAULT_FROM_EMAIL,
        reply_to: cfg.DEFAULT_REPLY_TO,
        created_by: currentUser.id,
      }).select("id").single();
      if (error) { toast(error.message, "error"); return; }
      close();
      location.hash = `#campaigns/${data.id}`;
    }}, "Create & open"),
  ));
}

async function renderCampaignEditor(id) {
  const main = $("#main"); main.innerHTML = '<p class="muted">Loading…</p>';

  const { data: c, error } = await sb.from("campaigns").select("*").eq("id", id).single();
  if (error || !c) { main.innerHTML = `<p class="muted">Campaign not found. <a href="#campaigns">Back</a></p>`; return; }

  const { data: lists } = await sb.from("lists").select("id, name").order("name");

  main.innerHTML = "";
  main.appendChild(el("div", { class: "page-head" },
    el("div", {}, el("h1", {}, c.name),
      el("p", { class: "muted" }, el("a", { href: "#campaigns" }, "← All campaigns"), "  ·  ",
        el("span", { class: `pill pill-${c.status}` }, c.status))),
    el("div", { class: "actions" },
      el("button", { class: "btn-ghost", onClick: () => save(false) }, "Save draft"),
      el("button", { class: "btn-ghost", onClick: openTestSend }, "Send test"),
      el("button", { class: "btn-ember", onClick: openSendConfirm, disabled: c.status === "sent" }, c.status === "sent" ? "Already sent" : "Send to list"),
    ),
  ));

  const form = el("div", {});
  const nameI    = el("input", { type: "text", value: c.name });
  const subjectI = el("input", { type: "text", value: c.subject || "", placeholder: "Subject line (under 60 chars)" });
  const previewI = el("input", { type: "text", value: c.preview_text || "", placeholder: "Inbox preview text" });
  const fromName = el("input", { type: "text", value: c.from_name });
  const fromEmail= el("input", { type: "text", value: c.from_email });
  const replyTo  = el("input", { type: "text", value: c.reply_to || "" });
  const listSel  = el("select", {});
  listSel.appendChild(el("option", { value: "" }, "— No list —"));
  (lists || []).forEach((l) => {
    const o = el("option", { value: l.id }, l.name);
    if (l.id === c.list_id) o.selected = true;
    listSel.appendChild(o);
  });
  const bodyHtmlI = el("textarea", { style: { minHeight: "260px", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "13px" } });
  bodyHtmlI.value = c.body_html || "";
  const bodyTextI = el("textarea", { style: { minHeight: "160px", fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: "13px" } });
  bodyTextI.value = c.body_text || "";

  form.appendChild(el("div", { class: "field" }, el("label", {}, "Campaign name"), nameI));
  form.appendChild(el("div", { class: "row row-2" },
    el("div", { class: "field" }, el("label", {}, "Recipient list"), listSel),
    el("div", { class: "field" }, el("label", {}, "Reply-to"), replyTo)));
  form.appendChild(el("div", { class: "row row-2" },
    el("div", { class: "field" }, el("label", {}, "From name"), fromName),
    el("div", { class: "field" }, el("label", {}, "From email"), fromEmail)));

  // AI prompt box
  const aiPromptT = el("textarea", { placeholder: "e.g. Recap yesterday's AI Advantage masterclass. Mention the 168 attendees, link to https://ignoraint.com/past-sessions/the-ai-advantage.html for the recording and ebook, invite replies with takeaways, and encourage them to forward to someone figuring out AI." });
  aiPromptT.style.minHeight = "120px";
  const aiContext = el("input", { type: "text", placeholder: "Optional context: event name, date, headcount, key URLs (comma-separated key=value)" });
  const aiBox = el("div", { class: "ai-prompt-box" },
    el("label", {}, "Draft with Claude"),
    aiPromptT,
    el("div", { style: { marginTop: "8px" } }, el("label", {}, "Extra context (optional)"), aiContext),
    el("div", { class: "ai-actions" },
      el("button", { class: "btn-ember btn-sm", id: "ai-draft", onClick: draftWithClaude }, "Generate draft"),
      el("small", { class: "muted" }, "Writes in Addie's voice. Takes ~10s."),
    ),
  );
  form.appendChild(aiBox);

  form.appendChild(el("div", { class: "row row-2" },
    el("div", { class: "field" }, el("label", {}, "Subject"), subjectI),
    el("div", { class: "field" }, el("label", {}, "Preview text"), previewI)));
  form.appendChild(el("div", { class: "field" }, el("label", {}, "Body (HTML)"), bodyHtmlI));
  form.appendChild(el("div", { class: "field" }, el("label", {}, "Body (plain text)"), bodyTextI));

  const preview = el("div", { class: "preview-pane", id: "preview-pane" });
  function renderPreview() {
    const subjectTxt = subjectI.value || "(no subject)";
    const fromLine   = `${fromName.value || ""} <${fromEmail.value || ""}>`;
    const html       = bodyHtmlI.value || '<p class="muted">No body yet.</p>';
    preview.innerHTML = `
      <div class="preview-meta">
        <strong>${esc(subjectTxt)}</strong>
        <div>${esc(fromLine)}</div>
        <div style="margin-top:4px">${esc(previewI.value || "")}</div>
      </div>
      <div>${html}</div>
    `;
  }
  [subjectI, previewI, fromName, fromEmail, bodyHtmlI].forEach((i) => i.addEventListener("input", renderPreview));

  const grid = el("div", { class: "editor-grid" }, form, el("div", {}, el("h3", {}, "Preview"), preview));
  main.appendChild(grid);
  renderPreview();

  async function save(silent) {
    const { error } = await sb.from("campaigns").update({
      name: nameI.value,
      subject: subjectI.value || null,
      preview_text: previewI.value || null,
      from_name: fromName.value,
      from_email: fromEmail.value,
      reply_to: replyTo.value || null,
      list_id: listSel.value || null,
      body_html: bodyHtmlI.value || null,
      body_text: bodyTextI.value || null,
    }).eq("id", id);
    if (error) { toast(error.message, "error"); return false; }
    if (!silent) toast("Saved.", "success");
    return true;
  }

  async function draftWithClaude() {
    if (!aiPromptT.value.trim()) { toast("Tell Claude what the email should say.", "error"); return; }
    const btn = $("#ai-draft");
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Drafting…';
    try {
      const context = {};
      aiContext.value.split(",").forEach((pair) => {
        const [k, ...rest] = pair.split("=");
        if (!k || !rest.length) return;
        context[k.trim()] = rest.join("=").trim();
      });
      const r = await apiCall("draft-email", { prompt: aiPromptT.value, campaign_id: id, context });
      subjectI.value   = r.subject || "";
      previewI.value   = r.preview_text || "";
      bodyHtmlI.value  = r.body_html || "";
      bodyTextI.value  = r.body_text || "";
      renderPreview();
      await save(true);
      toast("Draft ready — review and edit before sending.", "success");
    } catch (e) {
      toast(`Claude: ${e.message}`, "error");
    } finally {
      btn.disabled = false; btn.textContent = "Generate draft";
    }
  }

  async function openTestSend() {
    if (!(await save(true))) return;
    const box = el("div", {}, el("h2", {}, "Send test email"));
    const emailI = el("input", { type: "email", value: currentUser.email });
    box.appendChild(el("div", { class: "field" }, el("label", {}, "Send a copy to"), emailI));
    const { close } = openModal(box);
    box.appendChild(el("div", { class: "modal-actions" },
      el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
      el("button", { class: "btn-ember", onClick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Sending…';
        try {
          const r = await apiCall("send-campaign", { campaign_id: id, test_email: emailI.value.trim() });
          toast(`Test sent (${r.sent}/${r.total}).`, "success"); close();
        } catch (err) { toast(err.message, "error"); b.disabled = false; b.textContent = "Send test"; }
      }}, "Send test"),
    ));
  }

  async function openSendConfirm() {
    if (!(await save(true))) return;
    if (!listSel.value) { toast("Pick a list first.", "error"); return; }
    const { data: count } = await sb.rpc("list_subscribed_count", { p_list_id: listSel.value });
    if (!count) { toast("That list has no subscribed contacts.", "error"); return; }

    const box = el("div", {},
      el("h2", {}, "Send to the whole list?"),
      el("p", {}, `This will send to ${count} subscribed contact${count === 1 ? "" : "s"}. Are you sure?`),
    );
    const { close } = openModal(box);
    box.appendChild(el("div", { class: "modal-actions" },
      el("button", { class: "btn-ghost", onClick: close }, "Cancel"),
      el("button", { class: "btn-ember", onClick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Sending…';
        try {
          const r = await apiCall("send-campaign", { campaign_id: id });
          toast(`Sent ${r.sent}/${r.total}. ${r.failed ? r.failed + " failed." : ""}`, r.failed ? "error" : "success");
          close();
          renderCampaignEditor(id);
        } catch (err) { toast(err.message, "error"); b.disabled = false; b.textContent = "Confirm & send"; }
      }}, "Confirm & send"),
    ));
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
(async () => {
  const { data } = await sb.auth.getSession();
  if (data?.session) {
    currentUser = data.session.user;
    await onSignedIn();
  } else {
    showLogin();
  }
})();
