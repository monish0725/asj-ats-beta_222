// Single source of truth for role -> module access used to gate the raw HTTP API in
// server.js. This mirrors the ROLE_ACCESS table in public/app.js, which the frontend
// uses to hide/disable UI it knows the user can't use. That copy exists purely for a
// responsive UI; THIS copy is what actually gets enforced, since a client can always
// bypass JS and call the API directly. If you change permissions, update both places.
export const ROLE_ACCESS = {
  admin: {
    dashboard: "full", inbox: "full", candidates: "full", jobs: "full", pipeline: "full",
    outreach: "full", reports: "full", compliance: "full", users: "full", clients: "full", ai: "full", activity: "full",
    settings_profile: "full", settings_appearance: "full", settings_notifications: "full",
    settings_recruitment: "full", settings_clients: "full", settings_company: "full",
    settings_users: "full", settings_resumeParsing: "full", settings_ai: "full", settings_email: "full",
    settings_compliance: "full", settings_integrations: "full", settings_security: "full",
    settings_storage: "full", settings_reports: "full", settings_system: "full"
  },
  recruiter: {
    dashboard: "full", inbox: "full", candidates: "full", jobs: "full", pipeline: "full",
    outreach: "full", reports: "full", compliance: "full", users: "none", clients: "none", ai: "full", activity: "none",
    settings_profile: "full", settings_appearance: "full", settings_notifications: "full",
    settings_recruitment: "full", settings_clients: "none", settings_company: "none",
    settings_users: "none", settings_resumeParsing: "none", settings_ai: "none", settings_email: "none",
    settings_compliance: "none", settings_integrations: "none", settings_security: "none",
    settings_storage: "none", settings_reports: "none", settings_system: "none"
  },
  account_manager: {
    dashboard: "view", inbox: "view", candidates: "view", jobs: "full", pipeline: "full",
    outreach: "view", reports: "full", compliance: "view", users: "none", clients: "none", ai: "view", activity: "none",
    settings_profile: "full", settings_appearance: "full", settings_notifications: "full",
    settings_recruitment: "none", settings_clients: "full", settings_company: "none",
    settings_users: "none", settings_resumeParsing: "none", settings_ai: "none", settings_email: "none",
    settings_compliance: "none", settings_integrations: "none", settings_security: "none",
    settings_storage: "none", settings_reports: "none", settings_system: "none"
  },
  hiring_manager: {
    dashboard: "view", inbox: "none", candidates: "view", jobs: "view", pipeline: "full",
    outreach: "none", reports: "view", compliance: "none", users: "none", clients: "none", ai: "view", activity: "none",
    settings_profile: "full", settings_appearance: "full", settings_notifications: "full",
    settings_recruitment: "none", settings_clients: "none", settings_company: "none",
    settings_users: "none", settings_resumeParsing: "none", settings_ai: "none", settings_email: "none",
    settings_compliance: "none", settings_integrations: "none", settings_security: "none",
    settings_storage: "none", settings_reports: "none", settings_system: "none"
  },
  viewer: {
    dashboard: "limited", inbox: "view", candidates: "view", jobs: "view", pipeline: "view",
    outreach: "none", reports: "view", compliance: "none", users: "none", clients: "none", ai: "view", activity: "none",
    settings_profile: "full", settings_appearance: "full", settings_notifications: "none",
    settings_recruitment: "none", settings_clients: "none", settings_company: "none",
    settings_users: "none", settings_resumeParsing: "none", settings_ai: "none", settings_email: "none",
    settings_compliance: "none", settings_integrations: "none", settings_security: "none",
    settings_storage: "none", settings_reports: "none", settings_system: "none"
  }
};

// All settings category keys, in the order they should appear in the Settings nav.
export const SETTINGS_CATEGORIES = [
  "profile", "appearance", "notifications", "recruitment", "clients", "company", "users",
  "resumeParsing", "ai", "email", "compliance", "integrations", "security", "storage",
  "reports", "system"
];

export function normalizeRole(role) {
  const key = String(role || "").trim().toLowerCase().replace(/ /g, "_");
  return ROLE_ACCESS[key] ? key : "recruiter";
}

export function accessLevel(role, moduleKey) {
  return ROLE_ACCESS[normalizeRole(role)]?.[moduleKey] || "none";
}

export function canView(role, moduleKey) {
  return accessLevel(role, moduleKey) !== "none";
}

export function canEdit(role, moduleKey) {
  return ["full", "limited"].includes(accessLevel(role, moduleKey));
}

// Maps an /api/... pathname to the module key it belongs to, so every route gets
// gated the same way instead of hand-rolling a permission check per handler.
// Longest matching prefix wins, so more specific routes can be listed in any order.
const MODULE_ROUTES = [
  ["/api/candidates", "candidates"],
  ["/api/upload-resume", "inbox"],
  ["/api/upload-resumes", "inbox"],
  ["/api/import-folder", "inbox"],
  ["/api/sync-resumes", "inbox"],
  ["/api/resume-queue", "inbox"],
  ["/api/reparse-resumes", "inbox"],
  ["/api/website-resumes", "inbox"],
  ["/api/jobs", "jobs"],
  ["/api/extract-job", "jobs"],
  ["/api/applications", "pipeline"],
  ["/api/outreach-draft", "outreach"],
  ["/api/outreach", "outreach"],
  ["/api/reports", "reports"],
  ["/api/compliance", "compliance"],
  ["/api/ai-insight", "ai"],
  ["/api/activity-log", "activity"],
  // Each settings category maps to its own settings_<category> module key so every
  // role's view/edit access can be tuned per-category instead of settings being all-or-nothing.
  ...SETTINGS_CATEGORIES.map((category) => [`/api/settings/${category}`, `settings_${category}`])
];

export function moduleForApiPath(pathname) {
  let best = null;
  for (const [prefix, moduleKey] of MODULE_ROUTES) {
    if (pathname.startsWith(prefix) && (!best || prefix.length > best.prefix.length)) {
      best = { prefix, moduleKey };
    }
  }
  return best?.moduleKey || null;
}
