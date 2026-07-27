const state = {
  data: null,
  dashboard: null,
  recommendations: null,
  systemStatus: null,
  view: "dashboard",
  query: "",
  booleanQuery: "",
  booleanResults: new Map(),
  editingJobId: "",
  selectedCandidates: new Set(),
  selectedResumes: new Set(),
  candidateSort: { key: "match", direction: "desc" },
  candidatePage: 1,
  candidatePageSize: "all",
  resumeSearch: "",
  resumeStatusFilter: "",
  atsScoreFilter: "",
  atsSortBy: "",
  atsMissingKeywordsFilter: false,
  atsQualityFilter: "",
  candidateFilters: { search: "", job: "", stage: "", experience: "", openToWork: "", hotList: "" },
  complianceFilters: { search: "", status: "", visa: "", clearance: "", expiry: "" },
  notificationReadIds: new Set(),
  notificationsData: [],
  activityLogData: [],
  activitySearch: "",
  pipelineJobId: "",
  pipelineSearch: "",
  undoToken: "",
  aiChats: [],
  openedPreviousChatId: "",
  currentUser: null,
  scrollPositions: {},
  settingsData: { categories: [], settings: {}, editable: {} },
  profileData: null,
  usersData: [],
  activeSettingsCategory: "profile",
  settingsSaving: false
};

const stages = ["Applied", "Matched Candidates", "Interview", "Awaiting Decision", "Final Decision"];
const pipelineStages = stages;
const stageLabels = { Applied: "Applied Candidates" };

// ── ROLE-BASED ACCESS ──────────────────────────────────────────────────────
// Mirrors the Role Access Matrix shown in the Users page exactly.
// Access levels, from least to most capable:
//   "none"  -> module hidden entirely (nav item not shown)
//   "view"  -> module visible, but all create/edit/delete/send actions disabled
//   "limited" -> dashboard-only: visible with a reduced/summary view
//   "full"  -> complete access (also covers the matrix's "Approve", "Manage", "Review" labels,
//              since this beta does not yet model per-action sub-permissions)
const ROLE_ACCESS = {
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
// Settings categories, in nav order, with display metadata. Access to each is governed
// by the settings_<id> keys in ROLE_ACCESS above (mirrors backend/rbac.js exactly).
const SETTINGS_CATEGORY_META = [
  { id: "profile", label: "Profile", icon: "PR", group: "You" },
  { id: "appearance", label: "Appearance", icon: "AP", group: "You" },
  { id: "notifications", label: "Notifications", icon: "NT", group: "You" },
  { id: "recruitment", label: "Recruitment", icon: "RC", group: "Workspace" },
  { id: "clients", label: "Client Settings", icon: "CL", group: "Workspace" },
  { id: "company", label: "Company", icon: "CO", group: "Organization" },
  { id: "users", label: "User & Role Management", icon: "US", group: "Organization" },
  { id: "resumeParsing", label: "Resume Parsing", icon: "RP", group: "Organization" },
  { id: "ai", label: "AI Settings", icon: "AI", group: "Organization" },
  { id: "email", label: "Email & Notifications", icon: "EM", group: "Organization" },
  { id: "compliance", label: "Compliance", icon: "CM", group: "Organization" },
  { id: "integrations", label: "Integrations", icon: "IN", group: "Organization" },
  { id: "security", label: "Security", icon: "SC", group: "Organization" },
  { id: "storage", label: "File & Storage", icon: "FS", group: "Organization" },
  { id: "reports", label: "Reports & Export", icon: "RE", group: "Organization" },
  { id: "system", label: "System", icon: "SY", group: "Organization" }
];
const ROLE_LABELS = {
  admin: "Admin",
  recruiter: "Recruiter",
  account_manager: "Account Manager",
  "account manager": "Account Manager",
  hiring_manager: "Hiring Manager",
  "hiring manager": "Hiring Manager",
  viewer: "Viewer"
};
const NAV_MODULE_BY_VIEW = {
  dashboard: "dashboard", inbox: "inbox", candidates: "candidates", jobs: "jobs",
  pipeline: "pipeline", outreach: "outreach", reports: "reports", compliance: "compliance",
  clients: "clients", ai: "ai", activity: "activity"
  // "settings" is intentionally absent here: every role can open the page (they always
  // have at least Profile + Appearance), the categories shown inside it are what's gated.
};

function normalizeRole(role) {
  const key = String(role || "").trim().toLowerCase().replace(/ /g, "_");
  if (key === "admin") return "admin";
  if (key === "account_manager") return "account_manager";
  if (key === "hiring_manager") return "hiring_manager";
  if (key === "viewer") return "viewer";
  return "recruiter";
}

function currentRoleKey() {
  return normalizeRole(state.currentUser?.role);
}

function accessLevel(moduleKey) {
  const role = currentRoleKey();
  return ROLE_ACCESS[role]?.[moduleKey] || "none";
}

function canView(moduleKey) {
  return accessLevel(moduleKey) !== "none";
}

function canEdit(moduleKey) {
  return ["full", "limited"].includes(accessLevel(moduleKey));
}

function canViewSettings(category) {
  return canView(`settings_${category}`);
}

function canEditSettings(category) {
  return canEdit(`settings_${category}`);
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem("asjAtsSession");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(user, token = getSessionToken()) {
  sessionStorage.setItem("asjAtsSession", JSON.stringify({ user, token }));
}

function getSessionToken() {
  try {
    const raw = sessionStorage.getItem("asjAtsSession");
    const session = raw ? JSON.parse(raw) : null;
    return session?.token || "";
  } catch {
    return "";
  }
}

function clearSession() {
  sessionStorage.removeItem("asjAtsSession");
}

function applyRoleGating() {
  // Never gate the UI before we know who is logged in — if currentUser isn't set yet,
  // leave every nav item visible so nothing gets hidden by a missing-user false positive.
  if (!state.currentUser) return;

  $$(".nav").forEach((navButton) => {
    const moduleKey = NAV_MODULE_BY_VIEW[navButton.dataset.view];
    if (!moduleKey) return;
    const hidden = !canView(moduleKey);
    navButton.classList.toggle("role-hidden", hidden);
  });
  // If the user is currently on a view they don't have access to, redirect to dashboard.
  if (state.view && NAV_MODULE_BY_VIEW[state.view] && !canView(NAV_MODULE_BY_VIEW[state.view])) {
    switchView("dashboard");
  }
  $$("[data-role-restricted]").forEach((el) => {
    const restricted = !canEdit(el.dataset.roleRestricted);
    // Unauthorized actions are removed from layout entirely (display:none), not
    // grayed out/disabled -- a disabled-but-visible delete/export/bulk-action button
    // still tells an unauthorized user the feature exists, which isn't the goal here.
    el.classList.toggle("role-hidden", restricted);
    el.hidden = restricted;
    if (el.tagName === "BUTTON" || el.tagName === "SELECT" || el.tagName === "INPUT") el.disabled = restricted;
  });
  document.body.dataset.role = currentRoleKey();
  if ($("#dashboardActivityPanel")) $("#dashboardActivityPanel").hidden = currentRoleKey() !== "admin";
  $$("[data-quick-action-view]").forEach((el) => {
    el.hidden = !canView(el.dataset.quickActionView);
  });
  if ($("#dashboardInboxHealthPanel")) $("#dashboardInboxHealthPanel").hidden = !canView("inbox");
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const API_BASE_URL = String(window.ASJ_ATS_API_BASE_URL || "").replace(/\/+$/, "");

function apiUrl(path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function authHeaders() {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
    ...authHeaders(),
    ...(options.headers || {})
  };
  const res = await fetch(apiUrl(path), {
    credentials: API_BASE_URL ? "include" : "same-origin",
    ...options,
    headers
  });
  const body = await res.json();
  const isAuthFormRequest = String(path).startsWith("/auth/");
  if (res.status === 401 && !isAuthFormRequest) {
    // Session expired or was revoked mid-use (e.g. an admin disabled the account, or the
    // JWT expired). Every /api/* route now requires auth, so this can happen on any call --
    // send the user back to login instead of leaving the app stuck on a half-broken screen.
    state.currentUser = null;
    clearSession();
    showLoginScreen().catch(() => {});
  }
  if (!res.ok) throw new Error(body.error || "Request failed");
  return body;
}

function toast(message, type = "") {
  const el = $("#toast");
  el.textContent = message;
  el.className = "toast show" + (type ? " " + type : "");
  clearTimeout(el._toastTimer);
  el._toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function icon(name) {
  const paths = {
    view: `<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/>`,
    trash: `<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5"/><path d="M14 11v5"/>`,
    mail: `<path d="M4 6h16v12H4z"/><path d="m4 7 8 6 8-6"/>`,
    edit: `<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
    copy: `<path d="M8 8h10v12H8z"/><path d="M6 16H4V4h12v2"/>`,
    archive: `<path d="M4 7h16"/><path d="M5 7v13h14V7"/><path d="M8 4h8l2 3H6z"/><path d="M10 11h4"/>`,
    pipeline: `<path d="M4 6h6v6H4z"/><path d="M14 12h6v6h-6z"/><path d="M10 9h2a4 4 0 0 1 4 4v1"/>`,
    download: `<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>`
  };
  return `<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.view}</svg>`;
}

function inlineAiFormat(text) {
  return linkCandidateNames(String(text || ""))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function normalizeAiLine(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\s*[-*]\s+/, "")
    .trim();
}

function renderAiOutput(text, isError = false) {
  const out = $("#aiOutput");
  const rawLines = String(text || "").split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const rawLine of rawLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$|^\*\*([^*]+)\*\*:?\s*$/);
    const plainHeading = !/[.:;!?)]$/.test(trimmed) && trimmed.length <= 52 && !/^\d+[.)]\s+/.test(trimmed) && !/^[-*]\s+/.test(trimmed);
    if (headingMatch || plainHeading) {
      current = { title: normalizeAiLine(headingMatch?.[1] || headingMatch?.[2] || trimmed), items: [] };
      sections.push(current);
      continue;
    }

    const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    const labelMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)$/);
    const line = labelMatch ? `${labelMatch[1]}: ${labelMatch[2]}` : normalizeAiLine(numberedMatch ? numberedMatch[2] : trimmed);

    if (!current) {
      current = { title: isError ? "Unable to Generate Brief" : "Recruiter Brief", items: [] };
      sections.push(current);
    }
    current.items.push(line);
  }

  if (!sections.length) {
    out.className = "ai-output empty";
    out.innerHTML = `
      <div class="empty-state">
        <strong>No brief returned</strong>
        <span>Try a more specific request such as shortlist, coverage gaps, or outreach.</span>
      </div>
    `;
    return;
  }

  out.className = `ai-output${isError ? " error" : ""}`;
  out.innerHTML = sections.map((section, index) => `
    <section class="ai-brief-section ${index === 0 ? "lead" : ""}">
      <h3>${inlineAiFormat(section.title)}</h3>
      <div class="ai-brief-items">
        ${section.items.map((item) => {
          const [label, ...rest] = item.split(":");
          const hasLabel = rest.length && label.length < 34;
          return `
            <div class="ai-brief-item">
              ${hasLabel ? `<span>${inlineAiFormat(label)}</span><p>${inlineAiFormat(rest.join(":").trim())}</p>` : `<p>${inlineAiFormat(item)}</p>`}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `).join("");
}

async function loadActivityLog() {
  if (currentRoleKey() !== "admin") return;
  try {
    const result = await api("/api/activity-log");
    state.activityLogData = result.activities || [];
    renderActivityLog();
  } catch (error) {
    console.error("Failed to load activity log", error);
  }
}

function renderActivityLog() {
  if (!$("#activityLogList")) return;
  if (currentRoleKey() !== "admin") {
    $("#activityLogList").innerHTML = `<div class="activity">The Activity Log is only available to Admins.</div>`;
    return;
  }
  const search = (state.activitySearch || "").trim().toLowerCase();
  const activities = (state.activityLogData || [])
    .filter((activity) => !search || activity.message.toLowerCase().includes(search));
  $("#activityLogList").innerHTML = activities.slice(0, 200).map((activity) => `
    <div class="activity">
      ${escapeHtml(activity.message)}
      <time>${new Date(activity.createdAt).toLocaleString()}</time>
    </div>
  `).join("") || `<div class="activity">No activity found.</div>`;
}

const NOTIFICATION_CATEGORY_META = {
  account: "Account",
  ai_insight: "AI Insights",
  candidate_recommendation: "Candidate Recommendations",
  top_candidate: "Top Candidate Alerts",
  job_match: "New Job Matches",
  resume_parsing: "Resume Parsing",
  compliance: "Compliance Alerts",
  interview: "Upcoming Interviews",
  market_trend: "Market & Job Trends",
  system: "System Alerts"
};

async function loadNotifications() {
  try {
    const result = await api("/api/notifications");
    state.notificationsData = result.notifications || [];
    state.notificationReadIds = new Set(result.readIds || []);
    renderNotifications();
  } catch (error) {
    console.error("Failed to load notifications", error);
  }
}

function renderNotifications() {
  if (!$("#notificationList")) return;
  const notifications = state.notificationsData || [];
  const unread = notifications.filter((n) => !state.notificationReadIds.has(n.id));
  const badge = $("#notificationBadge");
  if (unread.length) {
    badge.hidden = false;
    badge.textContent = unread.length > 9 ? "9+" : String(unread.length);
  } else {
    badge.hidden = true;
  }
  if (!notifications.length) {
    $("#notificationList").innerHTML = `<div class="notification-empty">No notifications yet.</div>`;
    return;
  }
  const groups = [];
  notifications.forEach((n) => { if (!groups.includes(n.category)) groups.push(n.category); });
  $("#notificationList").innerHTML = groups.map((category) => `
    <div class="notification-group">
      <div class="notification-group-label">${escapeHtml(NOTIFICATION_CATEGORY_META[category] || category)}</div>
      ${notifications.filter((n) => n.category === category).map((n) => {
        const isUnread = !state.notificationReadIds.has(n.id);
        return `
          <div class="notification-item ${isUnread ? "unread" : ""}" data-notification-item="${n.id}" data-notification-target="${n.targetView || ""}">
            <strong>${escapeHtml(n.title)}</strong>
            <span>${escapeHtml(n.message)}</span>
            <time>${formatDate(n.createdAt)}</time>
          </div>
        `;
      }).join("")}
    </div>
  `).join("");
}

async function markNotificationRead(notificationId) {
  if (state.notificationReadIds.has(notificationId)) return;
  state.notificationReadIds.add(notificationId);
  renderNotifications();
  try {
    await api("/api/notifications/mark-read", { method: "POST", body: JSON.stringify({ activityId: notificationId }) });
  } catch {
    // best-effort; the read state stays applied locally either way
  }
}

async function markAllNotificationsRead() {
  (state.notificationsData || []).forEach((n) => state.notificationReadIds.add(n.id));
  renderNotifications();
  try {
    await api("/api/notifications/mark-all-read", { method: "POST", body: JSON.stringify({}) });
  } catch {
    // best-effort
  }
}
async function load() {
  const [data, dashboard, recommendations, systemStatus] = await Promise.all([api("/api/all"), api("/api/dashboard"), api("/api/recommendations"), api("/api/system-status")]);
  state.data = data;
  state.dashboard = dashboard;
  state.recommendations = recommendations;
  state.systemStatus = systemStatus;
  state.notificationReadIds = new Set(data.myNotificationReadIds || []);
  render();
  loadSettings();
  loadNotifications();
  loadActivityLog();
}

async function loadSettings() {
  try {
    const [settingsData, profileData] = await Promise.all([api("/api/settings"), api("/api/settings/profile")]);
    state.settingsData = settingsData;
    state.profileData = profileData;
    if (!state.settingsData.categories.includes(state.activeSettingsCategory)) {
      state.activeSettingsCategory = state.settingsData.categories[0] || "profile";
    }
    if (canViewSettings("users")) loadUsersData();
    applyThemeFromSettings();
    renderSettings();
  } catch (error) {
    console.error("Failed to load settings", error);
  }
}

async function loadUsersData() {
  try {
    const result = await api("/api/users");
    state.usersData = Array.isArray(result) ? result : (result.users || result.data || []);
    renderSettings();
  } catch (error) {
    console.error("Failed to load users", error);
  }
}

async function refreshRecommendations() {
  state.recommendations = await api("/api/recommendations");
}

async function applyServerState(result) {
  state.data = result.data;
  state.dashboard = result.dashboard;
  state.recommendations = result.recommendations || await api("/api/recommendations");
  state.systemStatus = await api("/api/system-status");
  render();
}

function filtered(items, fields) {
  const q = state.query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => fields.some((field) => {
    const value = typeof field === "function" ? field(item) : item[field];
    return String(Array.isArray(value) ? value.join(" ") : value || "").toLowerCase().includes(q);
  }));
}

function isBooleanLike(query) {
  return /\b(AND|OR|NOT)\b|[()"]/.test(String(query || ""));
}

function render() {
  renderDashboard();
  renderInbox();
  renderCandidates();
  renderJobs();
  renderPipeline();
  renderOutreach();
  renderReports();
  renderCompliance();
  renderActivityLog();
  renderClients();
  renderSystemStatus();
  renderJobOptions();
  renderAiStrip();
  renderAiSnapshot();
  renderAiChatHistory();
  renderPreviousAiChats();
  applyRoleGating();
  renderNotifications();
  renderSettings();
}

function renderAiStrip() {
  const recs = state.recommendations;
  if (!recs) return;

  const pageCopy = {
    dashboard: `Top priority: ${recs.attention[0] || "Pipeline is stable."}`,
    inbox: `${state.data.websiteResumes.filter((resume) => !resume.processed && resume.extractionQuality !== "poor").length} readable resume(s) ready for import; ${state.data.websiteResumes.filter((resume) => resume.extractionQuality === "poor").length} need review/OCR.`,
    candidates: recs.topCandidates[0] ? `Best active candidate: ${recs.topCandidates[0].name} for ${recs.topCandidates[0].bestJob} at ${recs.topCandidates[0].score}%.` : "No candidate recommendations yet.",
    jobs: recs.jobMatches[0] ? `${recs.jobMatches[0].title} has top match score ${recs.jobMatches[0].topScore}%.` : "No open jobs to match.",
    pipeline: `${state.data.applications.filter((app) => app.recommendation === "top candidate").length} top-candidate application(s) are in the pipeline.`,
    outreach: `${state.selectedCandidates.size} candidate(s) selected for outreach; ${state.data.outreachLog.length} communication record(s) logged.`,
    reports: `Recruitment funnel has ${state.data.applications.length} active application(s) with ${state.dashboard.kpis.avgMatch}% average match.`,
    compliance: "Visa, work rights, and clearance indicators are ready for recruiter validation.",
    users: `${state.data.users.length} user account(s) available. Role controls are backed by OTP authentication.`,
    clients: "Live checks show parser, OCR, file storage, and ATS intelligence status.",
    ai: "Ask questions, reuse chat history, open candidates, and prepare outreach from live ATS data."
  };

  $("#aiStripTitle").textContent = "AI, ATS Intelligence";
  $("#aiStripText").textContent = pageCopy[state.view] || pageCopy.dashboard;
}

function renderDashboard() {
  const apps = state.data.applications || [];
  const openJobs = state.data.jobs.filter((job) => job.status === "open");
  const candidatesAwaitingReview = state.data.websiteResumes.filter((resume) => resume.needsReview || resume.extractionQuality === "poor").length;
  const interviewsScheduled = apps.filter((app) => app.stage === "Interview").length;
  const avgMatch = apps.length ? Math.round(apps.reduce((sum, app) => sum + Number(app.matchScore || 0), 0) / apps.length) : state.dashboard.kpis.avgMatch || 0;
  const selectedCount = apps.filter((app) => app.decision === "Selected").length;
  const placementRate = apps.length ? Math.round((selectedCount / apps.length) * 100) : 0;
  const pipelineConversion = apps.length ? Math.round(((apps.filter((app) => ["Interview", "Awaiting Decision", "Final Decision"].includes(app.stage)).length) / apps.length) * 100) : 0;
  const jobsWithoutCandidates = openJobs.filter((job) => !apps.some((app) => app.jobId === job.id)).length;
  $("#kpis").innerHTML = [
    ["Candidates Awaiting Review", candidatesAwaitingReview],
    ["Interviews Scheduled", interviewsScheduled],
    ["Avg Match Score", `${avgMatch}%`],
    ["Placement Rate", `${placementRate}%`],
    ["Pipeline Conversion", `${pipelineConversion}%`],
    ["Jobs Without Candidates", jobsWithoutCandidates]
  ].map(([label, value]) => `
    <div class="kpi"><span>${label}</span><strong>${value}</strong></div>
  `).join("");

  const max = Math.max(...Object.values(state.dashboard.stageCounts), 1);
  $("#stageBars").innerHTML = stages.map((stage) => {
    const count = state.dashboard.stageCounts[stage] || 0;
    return `<div class="stage-row"><span>${stageLabels[stage] || stage}</span><div class="bar"><div style="width:${(count / max) * 100}%"></div></div><strong>${count}</strong></div>`;
  }).join("");

  $("#activities").innerHTML = state.dashboard.recentActivities.map((activity) => `
    <div class="activity ats-activity">${formatActivity(activity)}<time>${relativeTime(activity.createdAt)}</time></div>
  `).join("") || `<div class="activity">No activity yet.</div>`;

  const top = state.recommendations?.topCandidates || [];
  $("#dashboardMatches").innerHTML = top.slice(0, 5).map((candidate) => `
    <div class="rank-row dashboard-match-row">
      <div>
        <button class="link-button" data-preview="${candidate.candidateId}">${escapeHtml(candidate.name)}</button>
        <span>${escapeHtml(getCandidate(candidate.candidateId)?.currentRole || candidate.bestJob || "Candidate")}</span>
        <small>Matched skills: ${(candidate.skills || []).slice(0, 4).map(escapeHtml).join(", ") || "Profile fit"}</small>
      </div>
      <span class="score">${candidate.score}%</span>
    </div>
  `).join("") || `<div class="activity">No candidate matches yet.</div>`;

  const inbox = state.data.websiteResumes;
  const good = inbox.filter((resume) => resume.extractionQuality === "good").length;
  const partial = inbox.filter((resume) => resume.extractionQuality === "partial").length;
  const review = inbox.filter((resume) => resume.extractionQuality === "poor").length;
  $("#inboxHealth").innerHTML = [
    ["Total files", inbox.length, ""],
    ["Parsed", good, ""],
    ["Partial", partial, ""],
    ["Needs review", review, "review"]
  ].map(([label, value, filterKey]) => filterKey
    ? `<button type="button" class="health-card-clickable" data-dashboard-health-filter="${filterKey}"><span>${label}</span><strong>${value}</strong></button>`
    : `<div><span>${label}</span><strong>${value}</strong></div>`
  ).join("");
}

function getCandidate(candidateId) {
  return state.data.candidates.find((candidate) => candidate.id === candidateId);
}

function relativeTime(dateValue) {
  const diff = Date.now() - new Date(dateValue).getTime();
  const minutes = Math.max(0, Math.round(diff / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatActivity(activity) {
  const text = cleanActivityText(activity.message);
  if (/^(Monish|Priya|Admin|Recruiter|ASJ)\b/i.test(text)) return text;
  return `Admin performed ${text}`;
}

function cleanActivityText(message) {
  return escapeHtml(String(message || "")
    .replace(/website resume/gi, "resume")
    .replace(/Website Resume Inbox/g, "Resume Inbox")
    .replace(/parsed and synced into ASJ ATS/gi, "Candidate Added")
    .replace(/uploaded into Resume Inbox/gi, "Resume Uploaded")
    .replace(/job created with AI candidate matching/gi, "Job Created")
    .replace(/Application moved to/gi, "Candidate Moved Stage"));
}

// ═══════════════════════════════════════════════════════════════════════
// ATS Resume Analysis report
// ═══════════════════════════════════════════════════════════════════════
function ratingBadgeClass(rating) {
  return { Excellent: "done", Good: "done", Average: "warn", Poor: "danger-badge" }[rating] || "";
}

function renderAtsReportHtml(candidate, report) {
  if (!report) return `<div class="empty-state"><strong>No analysis yet</strong><span>This resume hasn't been analyzed.</span></div>`;
  const b = report.breakdown;
  const breakdownRows = [
    ["Skills", b.skills], ["Experience", b.experience], ["Education", b.education],
    ["Projects", b.projects], ["Certifications", b.certifications],
    ["Resume Structure", b.resumeStructure], ["Readability", b.readability], ["Keyword Coverage", b.keywordCoverage]
  ];
  return `
    <div class="ats-report">
      <section class="ats-report-section ats-summary">
        <div class="ats-score-hero ats-score-${atsScoreTier(report.atsScore)}">
          <strong>${report.atsScore}%</strong>
          <span>ATS Score</span>
        </div>
        <div class="ats-summary-body">
          <div class="ats-rating-row"><span class="badge ${ratingBadgeClass(report.rating)}">${escapeHtml(report.rating)}</span>
            ${report.jobContext ? `<span class="muted small">Benchmarked against: ${escapeHtml(report.jobContext.jobTitle)}</span>` : `<span class="muted small">General analysis (no open job to benchmark against)</span>`}
          </div>
          <div class="ats-summary-cols">
            <div><strong>Strengths</strong><ul>${report.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>
            <div><strong>Weaknesses</strong><ul>${report.weaknesses.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul></div>
          </div>
        </div>
      </section>

      <section class="ats-report-section">
        <h3>Score Breakdown</h3>
        <div class="ats-breakdown-grid">
          ${breakdownRows.map(([label, value]) => `
            <div class="ats-breakdown-row">
              <span>${escapeHtml(label)}</span>
              <div class="ats-bar"><span style="width:${value === null ? 0 : value}%"></span></div>
              <strong>${value === null ? "N/A" : `${value}%`}</strong>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="ats-report-section ats-two-col">
        <div>
          <h3>Missing Keywords</h3>
          ${report.missingKeywords.missing.length
            ? `<div class="settings-chip-list">${report.missingKeywords.missing.map((k) => `<span class="settings-chip ats-missing-chip">${escapeHtml(k)}</span>`).join("")}</div>`
            : `<p class="muted small">No significant keyword gaps detected.</p>`}
        </div>
        <div>
          <h3>Missing Resume Sections</h3>
          ${report.missingSections.length
            ? `<div class="settings-chip-list">${report.missingSections.map((s) => `<span class="settings-chip ats-missing-chip">${escapeHtml(s)}</span>`).join("")}</div>`
            : `<p class="muted small">All expected sections were found.</p>`}
        </div>
      </section>

      <section class="ats-report-section">
        <h3>Priority Recommendations</h3>
        <ol class="ats-priority-list">
          ${report.priorityRecommendations.map((item) => `<li><span class="badge ats-priority-${item.priority.toLowerCase()}">${escapeHtml(item.priority)}</span> ${escapeHtml(item.text)}</li>`).join("")}
        </ol>
      </section>

      <section class="ats-report-section">
        <h3>Resume Quality</h3>
        <div class="ats-quality-grid">
          <div><span>Bullet points</span><strong>${report.resumeQualitySignals.bulletCount}</strong></div>
          <div><span>Quantified achievements</span><strong>${report.resumeQualitySignals.quantifiedCount} (${report.resumeQualitySignals.quantifiedRatio}%)</strong></div>
          <div><span>Action verbs used</span><strong>${report.resumeQualitySignals.actionVerbCount}</strong></div>
          <div><span>Resume length</span><strong>${report.resumeQualitySignals.resumeLength} chars</strong></div>
          <div><span>Formatting</span><strong>${report.resumeQualitySignals.formattingReasons.length ? "Needs attention" : "Clean"}</strong></div>
        </div>
        ${report.resumeQualitySignals.formattingReasons.length ? `<ul class="ats-notes-list">${report.resumeQualitySignals.formattingReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
      </section>

      <section class="ats-report-section">
        <h3>Red Flags</h3>
        ${report.redFlags.length
          ? `<ul class="ats-redflag-list">${report.redFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>`
          : `<p class="muted small">No red flags detected.</p>`}
      </section>

      <section class="ats-report-section">
        <h3>Suggested Improvements</h3>
        ${report.suggestedImprovements.length
          ? `<ul class="ats-notes-list">${report.suggestedImprovements.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`
          : `<p class="muted small">No specific improvements flagged.</p>`}
      </section>

      <section class="ats-report-section">
        <h3>AI Resume Rewrite Suggestions</h3>
        <div class="ats-rewrite-block">
          <strong>Improved Professional Summary</strong>
          <p>${escapeHtml(report.aiRewriteSuggestions.professionalSummary)}</p>
        </div>
        <div class="ats-rewrite-block">
          <strong>Better Bullet Point Example</strong>
          <p>${escapeHtml(report.aiRewriteSuggestions.bulletPointExample)}</p>
        </div>
        <div class="ats-rewrite-block">
          <strong>Suggested Skills to Add</strong>
          <div class="settings-chip-list">${(report.aiRewriteSuggestions.suggestedSkillsToAdd || []).map((s) => `<span class="settings-chip">${escapeHtml(s)}</span>`).join("") || `<span class="muted small">None -- skill coverage looks solid.</span>`}</div>
        </div>
        <div class="ats-rewrite-block">
          <strong>Better Project Description Example</strong>
          <p>${escapeHtml(report.aiRewriteSuggestions.projectDescriptionExample)}</p>
        </div>
      </section>

      <p class="muted small">Generated ${formatDate(report.generatedAt)}. <button type="button" class="link-button" data-refresh-ats-report="${candidate.id}">Re-analyze now</button></p>
    </div>
  `;
}

async function openAtsReport(candidateId) {
  const candidate = state.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) return toast("Candidate not found", "error");
  $("#candidatePreviewName").textContent = `ATS Analysis · ${candidate.name}`;
  $("#candidatePreviewMeta").textContent = candidate.currentRole || "";
  $("#candidatePreviewBody").innerHTML = `<div class="empty-state"><strong>Loading analysis…</strong></div>`;
  $("#previewModal").hidden = false;
  let report = candidate.atsReport;
  if (!report) {
    try {
      const result = await api(`/api/candidates/${candidateId}/ats-report`);
      report = result.report;
      candidate.atsReport = report;
    } catch (error) {
      $("#candidatePreviewBody").innerHTML = `<div class="empty-state"><strong>Couldn't load analysis</strong><span>${escapeHtml(error.message || "")}</span></div>`;
      return;
    }
  }
  $("#candidatePreviewBody").innerHTML = renderAtsReportHtml(candidate, report);
}

async function refreshAtsReport(candidateId) {
  try {
    const result = await api(`/api/candidates/${candidateId}/ats-report/refresh`, { method: "POST" });
    const candidate = state.data.candidates.find((item) => item.id === candidateId);
    if (candidate) candidate.atsReport = result.report;
    toast("Resume re-analyzed", "success");
    // Re-render whichever view this was triggered from: the standalone ATS report
    // modal, or the full candidate profile (which embeds the same report inline).
    const isStandaloneReportView = $("#candidatePreviewName")?.textContent?.startsWith("ATS Analysis");
    if (isStandaloneReportView) openAtsReport(candidateId);
    else previewCandidate(candidateId);
  } catch (error) {
    toast(error.message || "Failed to re-analyze", "error");
  }
}

async function analyzeAllUnanalyzedResumes() {
  const btn = document.querySelector("#analyzeAllResumes");
  const original = btn ? btn.textContent : "";
  const pendingCount = state.data.candidates.filter((c) => !c.atsReport).length;
  if (!pendingCount) { toast("Every candidate already has an ATS analysis", "success"); return; }
  if (btn) { btn.disabled = true; btn.textContent = `Analyzing ${pendingCount}...`; }
  try {
    const result = await api("/api/candidates/ats-report/bulk-refresh", { method: "POST" });
    await applyServerState(result);
    toast(`Analyzed ${result.analyzed} resume(s)`, "success");
  } catch (error) {
    toast(error.message || "Bulk analysis failed", "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

function exportAtsReports() {
  const candidatesWithReports = state.data.candidates.filter((c) => c.atsReport);
  if (!candidatesWithReports.length) return toast("No analyzed resumes to export yet", "error");
  const headers = ["Candidate Name", "ATS Score", "Rating", "Skills %", "Experience %", "Education %", "Keyword Coverage %", "Missing Keywords", "Missing Sections", "Red Flags"];
  const rows = candidatesWithReports.map((c) => {
    const r = c.atsReport;
    return [
      c.name, r.atsScore, r.rating,
      r.breakdown.skills ?? "N/A", r.breakdown.experience ?? "N/A", r.breakdown.education ?? "N/A", r.breakdown.keywordCoverage,
      r.missingKeywords.missing.join("; "), r.missingSections.join("; "), r.redFlags.join("; ")
    ];
  });
  downloadCsv("asj-ats-reports.csv", headers, rows);
}

function atsScoreTier(score) {
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "average";
  return "poor";
}

function renderInbox() {
  const resumes = state.data.websiteResumes.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  const uploaded = resumes.length;
  const parsed = resumes.filter((resume) => resume.processed).length;
  const review = resumes.filter((resume) => resume.needsReview || resume.extractionQuality === "poor").length;
  const pending = resumes.filter((resume) => !resume.processed && !resume.needsReview && resume.extractionQuality !== "poor").length;
  const queue = resumeQueueStats(resumes);
  if ($("#parseStatus")) {
    $("#parseStatus").innerHTML = [
      ["Uploaded", uploaded, ""],
      ["Parsed", parsed, ""],
      ["Needs Review", review, "review"],
      ["Remaining", pending, "pending"]
    ].map(([label, value, filterKey]) => filterKey
      ? `<button type="button" class="parse-status-chip ${state.resumeStatusFilter === filterKey ? "active" : ""}" data-resume-status-filter="${filterKey}"><strong>${value}</strong> ${label}</button>`
      : `<span><strong>${value}</strong> ${label}</span>`
    ).join("");
  }
  if ($("#parsingDashboard")) {
    $("#parsingDashboard").innerHTML = `
      <div class="parse-progress-head">
        <strong>Parsing Dashboard</strong>
        <span>Processed: ${queue.processed} / ${queue.total} · Remaining: ${queue.remaining}</span>
      </div>
      <div class="parse-progress"><span style="width:${queue.percent}%"></span></div>
      <div class="parse-status-grid">
        <span><strong>${queue.Uploaded}</strong> Queued</span>
        <span><strong>${queue.Parsing}</strong> Processing</span>
        <span><strong>${queue.Parsed}</strong> Completed</span>
        <span><strong>${queue.Failed}</strong> Failed</span>
        <span><strong>${queue.avgSeconds}s</strong> Avg Parse</span>
        <span><strong>${queue.eta}</strong> ETA</span>
        <span><strong>${queue.filesPerMinute}</strong> Files/min</span>
      </div>
    `;
  }
  $("#resumeInbox").className = "resume-inbox-host";
  const resumesWithDerived = resumes.map((resume) => {
    const candidate = resume.candidateId ? state.data.candidates.find((item) => item.id === resume.candidateId) : null;
    const displayName = candidate?.name || inferResumeName(resume);
    const role = candidate?.currentRole || inferRoleFromResume(resume);
    const location = candidate?.location || inferLocationFromResume(resume);
    const skills = candidate?.skills?.length ? candidate.skills : inferSkillsFromResume(resume);
    return { resume, candidate, displayName, role, location, skills };
  });
  const statusFiltered = state.resumeStatusFilter === "review"
    ? resumesWithDerived.filter(({ resume }) => resume.needsReview || resume.extractionQuality === "poor")
    : state.resumeStatusFilter === "pending"
    ? resumesWithDerived.filter(({ resume }) => !resume.processed && !resume.needsReview && resume.extractionQuality !== "poor")
    : resumesWithDerived;
  const resumeQuery = state.resumeSearch.trim().toLowerCase();
  let filteredResumes = resumeQuery
    ? statusFiltered.filter(({ resume, displayName, role, location, skills }) => {
        const haystack = [displayName, role, location, resume.fileName, (skills || []).join(" ")].join(" ").toLowerCase();
        return haystack.includes(resumeQuery);
      })
    : statusFiltered;
  // ATS score filter/sort (Bulk Resume Analysis: filter by score, missing keywords, quality)
  if (state.atsScoreFilter) {
    const [min, max] = state.atsScoreFilter.split("-").map(Number);
    filteredResumes = filteredResumes.filter(({ candidate }) => {
      const score = candidate?.atsReport?.atsScore;
      return typeof score === "number" && score >= min && score <= max;
    });
  }
  if (state.atsMissingKeywordsFilter) {
    filteredResumes = filteredResumes.filter(({ candidate }) => (candidate?.atsReport?.missingKeywords?.missing?.length || 0) > 0);
  }
  if (state.atsQualityFilter) {
    filteredResumes = filteredResumes.filter(({ candidate }) => candidate?.atsReport?.rating === state.atsQualityFilter);
  }
  if (state.atsSortBy === "ats_desc" || state.atsSortBy === "ats_asc") {
    filteredResumes = [...filteredResumes].sort((a, b) => {
      const scoreA = a.candidate?.atsReport?.atsScore ?? -1;
      const scoreB = b.candidate?.atsReport?.atsScore ?? -1;
      return state.atsSortBy === "ats_desc" ? scoreB - scoreA : scoreA - scoreB;
    });
  }
  const statusFilterLabel = state.resumeStatusFilter === "review" ? "Needs Review" : state.resumeStatusFilter === "pending" ? "Remaining to parse" : "";
  $("#resumeInbox").innerHTML = `
    ${statusFilterLabel ? `<div class="active-filter-bar">Showing: <strong>${statusFilterLabel}</strong><button type="button" data-clear-resume-status-filter>Clear filter ×</button></div>` : ""}
    <div class="bulk-grid-toolbar">
      <label><input id="resumeTableSelectAll" type="checkbox" ${resumes.length && resumes.every((resume) => state.selectedResumes.has(resume.id)) ? "checked" : ""} /> Select all</label>
      <span>${state.selectedResumes.size} selected</span>
      <button class="secondary compact-button" data-bulk-resume-action="parse" data-role-restricted="inbox">Parse selected</button>
      <button class="secondary compact-button" data-bulk-resume-action="review" data-role-restricted="inbox">Mark review</button>
      <button class="secondary compact-button danger" data-bulk-resume-action="delete" data-role-restricted="inbox">Delete selected</button>
      <div class="search-control resume-search-control">
        <input id="resumeSearchInput" placeholder="Search resumes by name, role, skills, location, or file..." value="${escapeHtml(state.resumeSearch)}" />
        ${state.resumeSearch ? `<button class="clear-search" data-clear-input="resumeSearchInput" type="button" title="Clear search">×</button>` : ""}
      </div>
    </div>
    <div class="bulk-grid-toolbar ats-toolbar">
      <label class="ats-toolbar-field">ATS Score
        <select id="atsScoreFilter">
          <option value="">All</option>
          <option value="85-100" ${state.atsScoreFilter === "85-100" ? "selected" : ""}>85-100 (Excellent)</option>
          <option value="70-84" ${state.atsScoreFilter === "70-84" ? "selected" : ""}>70-84 (Good)</option>
          <option value="50-69" ${state.atsScoreFilter === "50-69" ? "selected" : ""}>50-69 (Average)</option>
          <option value="0-49" ${state.atsScoreFilter === "0-49" ? "selected" : ""}>0-49 (Poor)</option>
        </select>
      </label>
      <label class="ats-toolbar-field">Sort
        <select id="atsSortBy">
          <option value="" ${!state.atsSortBy ? "selected" : ""}>Default</option>
          <option value="ats_desc" ${state.atsSortBy === "ats_desc" ? "selected" : ""}>ATS Score: High to Low</option>
          <option value="ats_asc" ${state.atsSortBy === "ats_asc" ? "selected" : ""}>ATS Score: Low to High</option>
        </select>
      </label>
      <label class="ats-toolbar-checkbox"><input type="checkbox" id="atsMissingKeywordsFilter" ${state.atsMissingKeywordsFilter ? "checked" : ""} /> Missing keywords only</label>
      <label class="ats-toolbar-field">Quality
        <select id="atsQualityFilter">
          <option value="">All</option>
          <option value="Excellent" ${state.atsQualityFilter === "Excellent" ? "selected" : ""}>Excellent</option>
          <option value="Good" ${state.atsQualityFilter === "Good" ? "selected" : ""}>Good</option>
          <option value="Average" ${state.atsQualityFilter === "Average" ? "selected" : ""}>Average</option>
          <option value="Poor" ${state.atsQualityFilter === "Poor" ? "selected" : ""}>Poor</option>
        </select>
      </label>
      <button class="secondary compact-button" id="exportAtsReports">Export ATS Reports</button>
      <button class="secondary compact-button" id="analyzeAllResumes">Analyze All Unanalyzed</button>
    </div>
    <div class="ats-table-wrap resume-table-scroll">
    <table class="ats-table resume-table dense-grid">
      <thead>
        <tr>
          <th class="select-col"></th>
          <th>Candidate Name</th>
          <th>Current Role</th>
          <th>Location</th>
          <th>Experience</th>
          <th>Skills</th>
          <th>ATS Score</th>
          <th>Match Score</th>
          <th>Open To Work</th>
          <th>Parse Status</th>
          <th>Last Updated</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${filteredResumes.map(({ resume, candidate, displayName, role, location, skills }) => {
    const experience = candidate?.experienceYears ?? inferExperienceFromText(resume.resumeText);
    const matchScore = getCandidateMatchScore(candidate?.id || resume.candidateId);
    const atsReport = candidate?.atsReport;
    const openToWork = inferOpenToWork(candidate, resume);
    const status = resume.queueStatus || (resume.processed ? "Parsed" : resume.needsReview || resume.extractionQuality === "poor" ? "Failed" : resume.parser ? "Uploaded" : "Pending");
    return `
          <tr class="${state.selectedResumes.has(resume.id) ? "selected-row" : ""}">
            <td><input type="checkbox" data-select-resume="${resume.id}" ${state.selectedResumes.has(resume.id) ? "checked" : ""} aria-label="Select ${escapeHtml(displayName)}" /></td>
            <td>
              <button class="link-button resume-name-link primary-name" data-resume-preview="${resume.id}">${escapeHtml(displayName)}</button>
              ${resume.duplicateSuggestion ? `<div class="muted warn-text">${escapeHtml(resume.duplicateSuggestion)}</div>` : ""}
            </td>
            <td>${escapeHtml(role)}</td>
            <td>${escapeHtml(location)}</td>
            <td>${Number(experience || 0)} yrs</td>
            <td><span class="single-line-skill">${compactSkills(skills)}</span></td>
            <td>${atsReport
              ? `<button type="button" class="ats-score-link ats-score-${atsScoreTier(atsReport.atsScore)}" data-ats-report="${candidate?.id || ""}">${atsReport.atsScore}%</button>`
              : candidate?.id ? `<button type="button" class="ats-score-link ats-score-pending" data-ats-report="${candidate.id}">Analyze</button>` : `<span class="muted small">Not analyzed</span>`}</td>
            <td><strong class="score">${matchScore}%</strong></td>
            <td><span class="badge ${openToWork ? "done" : ""}">${openToWork ? "Yes" : "No"}</span></td>
            <td><span class="badge ${status === "Parsed" ? "done" : status === "Parsing" ? "warn" : status === "Failed" ? "danger-badge" : ""}">${status}</span></td>
            <td>${formatDate(resume.reviewedAt || resume.processedAt || resume.reparsedAt || resume.submittedAt)}</td>
            <td>
              <div class="table-actions">
                <button class="icon-action" data-resume-preview="${resume.id}" title="Preview" aria-label="Preview resume">${icon("view")}</button>
                <button class="icon-action danger" data-delete-resume="${resume.id}" data-role-restricted="inbox" title="Delete" aria-label="Delete resume">${icon("trash")}</button>
              </div>
            </td>
          </tr>
    `;
        }).join("")}
      </tbody>
    </table>
    </div>
    ${filteredResumes.length === 0 && resumeQuery ? `<div class="empty-inline">No resumes match "${escapeHtml(state.resumeSearch)}".</div>` : ""}
  `;
}

function inferResumeName(resume) {
  const text = String(resume.resumeText || "");
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const line = lines.find((item) => !/@|phone|mobile|ph:|\+?\d{7}/i.test(item)) || (email ? text.slice(0, text.indexOf(email)).trim() : "");
  return line.split(/\s+/).slice(0, 3).join(" ") || resume.fileName || "Resume";
}

function inferRoleFromResume(resume) {
  const text = normalizeText(resume.resumeText || "");
  if (text.includes("devops") || text.includes("kubernetes")) return "Cloud DevOps Engineer";
  if (text.includes("data analyst") || text.includes("power bi")) return "Data Analyst";
  if (text.includes("machine learning") || text.includes("artificial intelligence") || text.includes(" ai ")) return "AI/ML Engineer";
  if (text.includes("react") || text.includes("node")) return "Full Stack Developer";
  return resume.roleCategory || "Candidate";
}

function inferExperienceFromText(text) {
  return Number(String(text || "").match(/(\d{1,2})\s*(?:\+?\s*)?(?:years?|yrs?)/i)?.[1] || 0);
}

function inferSkillsFromResume(resume) {
  const text = normalizeText(resume.resumeText || "");
  const known = ["React", "Node.js", "AWS", "Docker", "Kubernetes", "Terraform", "Python", "SQL", "Power BI", "Machine Learning", "AI", "ML", "Java", "Spring Boot", "MongoDB", "Figma", "C"];
  return known.filter((skill) => text.includes(normalizeText(skill)));
}

function compactSkills(skills = []) {
  const visible = skills.filter(Boolean).slice(0, 4).join(", ");
  return escapeHtml(`${visible || "Skills pending"}${skills.length > 4 ? ` +${skills.length - 4}` : ""}`);
}

function inferLocationFromResume(resume) {
  const text = String(resume.resumeText || "");
  const city = text.match(/\b(New York|San Francisco|Austin|Dallas|Chicago|Boston|Seattle|Atlanta|Hyderabad|Bangalore|Bengaluru|Chennai|Mumbai|Pune|Delhi|Noida|Remote)\b/i)?.[0];
  return city || "Not listed";
}

function inferOpenToWork(candidate, resume) {
  const value = candidate?.openToWork;
  if (typeof value === "boolean") return value;
  const text = normalizeText(`${candidate?.availability || ""} ${candidate?.resumeText || ""} ${resume?.resumeText || ""}`);
  return /open to work|immediate joiner|available immediately|actively looking|seeking/i.test(text);
}

function isHotCandidate(candidate) {
  if (typeof candidate?.hotList === "boolean") return candidate.hotList;
  return inferOpenToWork(candidate, null);
}

function getCandidateMatchScore(candidateId) {
  if (!candidateId) return 0;
  const appScore = state.data.applications
    .filter((app) => app.candidateId === candidateId)
    .reduce((best, app) => Math.max(best, Number(app.matchScore || 0)), 0);
  const recScore = (state.recommendations?.topCandidates || [])
    .filter((candidate) => candidate.candidateId === candidateId)
    .reduce((best, candidate) => Math.max(best, Number(candidate.score || 0)), 0);
  return Math.max(appScore, recScore);
}

function resumeQueueStats(resumes) {
  const counts = { Uploaded: 0, Parsing: 0, Parsed: 0, Failed: 0 };
  for (const resume of resumes) {
    const status = resume.queueStatus || (resume.processed ? "Parsed" : resume.extractionQuality === "poor" ? "Failed" : "Uploaded");
    counts[counts[status] === undefined ? "Uploaded" : status] += 1;
  }
  const processed = counts.Parsed + counts.Failed;
  const total = resumes.length;
  const durations = resumes
    .filter((resume) => resume.startedAt && (resume.processedAt || resume.reviewedAt || resume.reparsedAt))
    .map((resume) => Math.max(1, (new Date(resume.processedAt || resume.reviewedAt || resume.reparsedAt).getTime() - new Date(resume.startedAt).getTime()) / 1000))
    .filter(Number.isFinite);
  const avgSeconds = durations.length ? Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length) : 0;
  const filesPerMinute = avgSeconds ? Math.max(1, Math.round(60 / avgSeconds)) : 0;
  const etaSeconds = avgSeconds * Math.max(0, total - processed);
  return {
    ...counts,
    total,
    processed,
    remaining: Math.max(0, total - processed),
    percent: total ? Math.round((processed / total) * 100) : 0,
    avgSeconds,
    filesPerMinute,
    eta: etaSeconds ? `${Math.ceil(etaSeconds / 60)} min` : "0 min"
  };
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not updated";
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function renderCandidates() {
  renderCandidateFilterOptions();
  const filteredCandidates = applyCandidateFilters(state.data.candidates);
  const candidates = sortCandidates(filteredCandidates);
  const showAll = state.candidatePageSize === "all";
  const pageCount = showAll ? 1 : Math.max(1, Math.ceil(candidates.length / state.candidatePageSize));
  state.candidatePage = Math.min(state.candidatePage, pageCount);
  const pageStart = showAll ? 0 : (state.candidatePage - 1) * state.candidatePageSize;
  const visible = showAll ? candidates : candidates.slice(pageStart, pageStart + state.candidatePageSize);
  $("#candidateRows").className = "ats-data-grid";
  $("#candidateRows").innerHTML = `
    <div class="table-wrap ats-table-wrap">
      <table class="ats-table candidate-table dense-grid">
        <thead>
          <tr>
            <th class="select-col"><input type="checkbox" id="candidateTableSelectAll" ${visible.length > 0 && visible.every((candidate) => state.selectedCandidates.has(candidate.id)) ? "checked" : ""} /></th>
            ${sortableTh("name", "Candidate Name")}
            ${sortableTh("role", "Current Role")}
            ${sortableTh("location", "Location")}
            ${sortableTh("experience", "Experience")}
            ${sortableTh("match", "Match %")}
            ${sortableTh("stage", "Pipeline Stage")}
            <th>Open To Work</th>
            <th>Hot List</th>
            ${sortableTh("updated", "Last Activity")}
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
        ${visible.map((candidate) => {
    const bestMatch = candidateBestMatch(candidate);
    const stage = candidatePipelineStage(candidate);
    const openToWork = inferOpenToWork(candidate, null);
    const hot = isHotCandidate(candidate);
    const gaps = candidateSkillGaps(candidate);
    return `
          <tr class="${state.selectedCandidates.has(candidate.id) ? "selected-row" : ""}">
            <td><input type="checkbox" data-select-candidate="${candidate.id}" ${state.selectedCandidates.has(candidate.id) ? "checked" : ""} aria-label="Select ${escapeHtml(candidate.name)}" /></td>
            <td>
              <button class="link-button candidate-name primary-name" data-preview="${candidate.id}">${escapeHtml(candidate.name)}</button>
            </td>
            <td>${escapeHtml(candidate.currentRole || "Candidate")}</td>
            <td>${escapeHtml(candidate.location || "Location not set")}</td>
            <td>${candidate.experienceYears || 0} yrs</td>
            <td><strong class="match-score ${matchScoreClass(bestMatch.score)}">${bestMatch.score || 0}%</strong></td>
            <td><span class="badge">${escapeHtml(stageLabels[stage] || stage)}</span>${gaps ? `<div class="muted table-subline">Gaps: ${escapeHtml(gaps)}</div>` : ""}</td>
            <td>${openToWork ? `<span class="open-work-badge open"><span></span>Open</span>` : `<span class="open-work-badge closed"><span></span>Closed</span>`}</td>
            <td>${hot ? `<span class="badge hot-badge">Hot</span>` : `<span class="muted">—</span>`}</td>
            <td>${formatDate(candidate.updatedAt || candidate.createdAt)}</td>
            <td>
        <div class="table-actions">
          <button class="icon-action" data-preview="${candidate.id}" title="Preview" aria-label="Preview candidate">${icon("view")}</button>
          <button class="icon-action" data-email-candidate="${candidate.id}" data-role-restricted="candidates" title="Email" aria-label="Email candidate">${icon("mail")}</button>
          <button class="icon-action danger" data-delete-candidate="${candidate.id}" data-role-restricted="candidates" title="Delete" aria-label="Delete candidate">${icon("trash")}</button>
        </div>
            </td>
          </tr>
        `;
        }).join("")}
        </tbody>
      </table>
    </div>
    <div class="pagination-bar">
      <span>${candidates.length} candidate(s)${showAll ? "" : ` · Page ${state.candidatePage} of ${pageCount}`}</span>
      <div class="table-actions">
        <label class="page-size-picker">
          View:
          <select id="candidatePageSize">
            <option value="25" ${state.candidatePageSize === 25 ? "selected" : ""}>25 per page</option>
            <option value="50" ${state.candidatePageSize === 50 ? "selected" : ""}>50 per page</option>
            <option value="100" ${state.candidatePageSize === 100 ? "selected" : ""}>100 per page</option>
            <option value="all" ${showAll ? "selected" : ""}>All candidates</option>
          </select>
        </label>
        ${showAll ? "" : `
        <button data-candidate-page="${state.candidatePage - 1}" ${state.candidatePage <= 1 ? "disabled" : ""}>Previous</button>
        <button data-candidate-page="${state.candidatePage + 1}" ${state.candidatePage >= pageCount ? "disabled" : ""}>Next</button>
        `}
      </div>
    </div>
  `;
  if (!candidates.length) {
    $("#candidateRows").innerHTML = `<div class="empty-inline">No candidates match the current search or filters.</div>`;
  }
}

function renderCandidateFilterOptions() {
  const jobFilter = $("#candidateJobFilter");
  if (!jobFilter) return;
  const current = state.candidateFilters.job || jobFilter.value;
  jobFilter.innerHTML = `<option value="">Job</option>${state.data.jobs.map((job) => `<option value="${job.id}" ${job.id === current ? "selected" : ""}>${escapeHtml(job.title)}</option>`).join("")}`;
  $("#candidateSearch").value = state.candidateFilters.search;
  $("#candidateStageFilter").value = state.candidateFilters.stage;
  $("#candidateExperienceFilter").value = state.candidateFilters.experience;
  $("#candidateOpenFilter").value = state.candidateFilters.openToWork;
  $("#candidateHotFilter").value = state.candidateFilters.hotList;
}

function sortableTh(key, label) {
  const active = state.candidateSort.key === key;
  const marker = active ? (state.candidateSort.direction === "asc" ? "↑" : "↓") : "";
  return `<th><button class="sort-header" data-candidate-sort="${key}">${label} ${marker}</button></th>`;
}

function sortCandidates(candidates) {
  const direction = state.candidateSort.direction === "asc" ? 1 : -1;
  const valueFor = (candidate) => {
    const match = candidateBestMatch(candidate);
    const stage = candidatePipelineStage(candidate);
    const values = {
      name: candidate.name || "",
      role: candidate.currentRole || "",
      experience: Number(candidate.experienceYears || 0),
      location: candidate.location || "",
      match: Number(match.score || 0),
      stage,
      updated: new Date(candidate.updatedAt || candidate.createdAt || 0).getTime()
    };
    return values[state.candidateSort.key] ?? values.match;
  };
  return candidates.slice().sort((a, b) => {
    const av = valueFor(a);
    const bv = valueFor(b);
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * direction;
    return String(av).localeCompare(String(bv)) * direction;
  });
}

function normalizeStageName(stage) {
  const aliases = {
    "Applied candidates": "Applied",
    "Applied Candidates": "Applied",
    "Best match": "Matched Candidates",
    "Best Match": "Matched Candidates",
    Screened: "Matched Candidates",
    Screening: "Matched Candidates",
    Selected: "Final Decision",
    Rejected: "Final Decision"
  };
  return aliases[stage] || (pipelineStages.includes(stage) ? stage : "Applied");
}

function candidatePipelineStage(candidate) {
  const apps = state.data.applications
    .filter((app) => app.candidateId === candidate.id)
    .sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0));
  return apps[0] ? normalizeStageName(apps[0].stage) : "Not assigned";
}

function candidateBestMatch(candidate) {
  const apps = state.data.applications.filter((app) => app.candidateId === candidate.id).sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0));
  const bestApp = apps[0];
  const rec = (state.recommendations?.topCandidates || []).find((item) => item.candidateId === candidate.id);
  return {
    title: bestApp?.job?.title || rec?.bestJob || "No linked job",
    score: Number(bestApp?.matchScore || rec?.score || 0),
    label: bestApp?.recommendation || rec?.recommendation || "Needs match review"
  };
}

function candidateSkillGaps(candidate) {
  const apps = state.data.applications
    .filter((app) => app.candidateId === candidate.id)
    .sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0));
  const gaps = apps[0]?.skillGaps || [];
  return gaps.length ? gaps.slice(0, 2).join(", ") + (gaps.length > 2 ? ` +${gaps.length - 2}` : "") : "";
}

function candidateInitials(name) {
  return String(name || "C")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "C";
}

function renderCandidateJobs(candidate) {
  const apps = state.data.applications.filter((app) => app.candidateId === candidate.id);
  if (!apps.length) return `<span class="muted">No linked jobs</span>`;
  return apps.sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0)).map((app) => `
    <button class="job-link-chip" data-open-job="${app.jobId}" title="${escapeHtml(app.job?.title || "Job")}">
      <span class="job-chip-icon" aria-hidden="true"></span>
      <span class="job-chip-copy"><strong>${escapeHtml(app.job?.title || "Job")}</strong><em>${app.matchScore}% match</em></span>
    </button>
  `).join("");
}

function applyCandidateFilters(candidates) {
  const filters = state.candidateFilters;
  const q = `${isBooleanLike(filters.search) ? "" : filters.search} ${isBooleanLike(state.query) ? "" : state.query}`.trim().toLowerCase();
  const experienceFilter = Number(filters.experience || 0);
  return candidates
    .map((candidate) => ({ candidate, result: state.booleanResults.get(candidate.id) }))
    .filter(({ candidate, result }) => {
      const apps = state.data.applications.filter((app) => app.candidateId === candidate.id);
      const text = `${candidate.name} ${candidate.currentRole} ${candidate.location} ${(candidate.skills || []).join(" ")} ${candidate.email || ""}`.toLowerCase();
      const searchOk = !q || text.includes(q);
      const jobOk = !filters.job || apps.some((app) => app.jobId === filters.job);
      const stageOk = !filters.stage || apps.some((app) => normalizeStageName(app.stage) === filters.stage);
      const experienceOk = !experienceFilter || Number(candidate.experienceYears || 0) >= experienceFilter;
      const open = inferOpenToWork(candidate, null);
      const hot = isHotCandidate(candidate);
      const openOk = !filters.openToWork || (filters.openToWork === "yes" ? open : !open);
      const hotOk = !filters.hotList || (filters.hotList === "yes" ? hot : !hot);
      const booleanOk = !state.booleanQuery.trim() || result?.matched;
      return searchOk && jobOk && stageOk && experienceOk && openOk && hotOk && booleanOk;
    })
    .sort((a, b) => (b.result?.score || 0) - (a.result?.score || 0))
    .map(({ candidate }) => candidate);
}

function matchScoreClass(score) {
  const value = Number(score || 0);
  if (value >= 90) return "match-green";
  if (value >= 70) return "match-amber";
  return "match-red";
}

function renderBooleanCell(candidate, hasBoolean) {
  if (!hasBoolean) return `<span class="badge">${candidate.status}</span><div class="muted">${candidate.source}</div>`;
  const result = state.booleanResults.get(candidate.id);
  if (!result) return `<span class="badge warn">Not tested</span>`;
  return `
    <span class="badge ${result.matched ? "done" : "warn"}">${result.score}% match</span>
    <div class="muted">Matched: ${result.matchedTerms.join(", ") || "None"}</div>
    <div class="muted">Missing: ${result.missingTerms.join(", ") || "None"}</div>
  `;
}

function renderJobs() {
  const jobs = filtered(state.data.jobs, ["title", "location", "priority", "clearance", "description", "department", (job) => job.skills || []]);
  $("#jobCards").innerHTML = jobs.map((job) => {
    const apps = state.data.applications.filter((app) => app.jobId === job.id).sort((a, b) => b.matchScore - a.matchScore);
    const topThree = apps.slice(0, 3);
    return `
      <article class="job-card">
        <div class="card-head">
          <div>
            <h2><button class="link-button job-title-link" data-preview-job="${job.id}">${escapeHtml(job.title)}</button></h2>
            <div class="muted">${job.location} · ${job.employmentType || "Full time"}</div>
          </div>
          <span class="badge">${job.priority || "Medium"}</span>
        </div>
        <div class="job-meta">
          <span>${job.status || "open"}</span>
          <span>${job.clearance || "No clearance"}</span>
          <span>Start: ${job.startDate || "TBD"}</span>
          <span>Close: ${job.closingDate || "TBD"}</span>
        </div>
        <p>${job.description}</p>
        <div class="skills">${job.skills.map((skill) => `<span class="skill">${skill}</span>`).join("")}</div>
        <details class="suggestion top-match-dropdown">
          <summary>Top candidates <span>${topThree.length}</span></summary>
          ${topThree.length ? topThree.map((app) => `
            <div class="match-row">
              <button class="link-button" data-preview="${app.candidateId}">${escapeHtml(app.candidate?.name || "Unknown")}</button>
              <span class="score">${app.matchScore}%</span>
              <button class="icon-action" data-preview="${app.candidateId}" title="Preview candidate">${icon("view")}</button>
            </div>
            <div class="muted">${app.recommendation || "matched"} · Skill gaps: ${app.skillGaps.length ? app.skillGaps.join(", ") : "None"}</div>
          `).join("") : `<div class="muted">No candidates matched yet.</div>`}
        </details>
        <div class="card-actions">
          <button class="icon-action" data-preview-job="${job.id}" title="Preview">${icon("view")}</button>
          <button class="icon-action" data-edit-job="${job.id}" data-role-restricted="jobs" title="Edit">${icon("edit")}</button>
          <button class="icon-action" data-duplicate-job="${job.id}" data-role-restricted="jobs" title="Duplicate">${icon("copy")}</button>
          ${job.status !== "closed" ? `<button class="icon-action" data-close-job="${job.id}" data-role-restricted="jobs" title="Archive">${icon("archive")}</button>` : ""}
          <button class="icon-action" data-open-job="${job.id}" title="Open Pipeline">${icon("pipeline")}</button>
          <button class="icon-action danger" data-delete-job="${job.id}" data-role-restricted="jobs" title="Delete">${icon("trash")}</button>
        </div>
      </article>
    `;
  }).join("");
}

function previewJob(jobId) {
  const job = state.data.jobs.find((item) => item.id === jobId);
  if (!job) return;
  $("#candidatePreviewName").textContent = job.title;
  $("#candidatePreviewMeta").textContent = `${job.location || "Location not set"} · ${job.employmentType || "Full time"} · ${job.status || "open"}`;
  $("#candidatePreviewBody").innerHTML = `
    <div class="resume-sheet job-preview-sheet">
      <h3>${escapeHtml(job.title)}</h3>
      <p>${escapeHtml(job.department || "Recruitment")} ${job.client ? `· ${escapeHtml(job.client)}` : ""}</p>
      <div class="job-meta">
        <span>${escapeHtml(job.status || "open")}</span>
        <span>${escapeHtml(job.priority || "Medium")}</span>
        <span>${escapeHtml(job.clearance || "No clearance")}</span>
        <span>Start: ${escapeHtml(job.startDate || "TBD")}</span>
        <span>Close: ${escapeHtml(job.closingDate || "TBD")}</span>
      </div>
      <h4>Skills</h4>
      <div class="skills">${(job.skills || []).map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`).join("") || `<span class="muted">No skills listed</span>`}</div>
      <h4>Description</h4>
      <p>${escapeHtml(job.description || "No job description available.")}</p>
      <div class="card-actions">
        <button class="icon-action" data-edit-job="${job.id}" title="Edit">${icon("edit")}</button>
        <button class="icon-action" data-duplicate-job="${job.id}" title="Duplicate">${icon("copy")}</button>
        ${job.status !== "closed" ? `<button class="icon-action" data-close-job="${job.id}" title="Archive">${icon("archive")}</button>` : ""}
      </div>
    </div>
  `;
  $("#previewModal").hidden = false;
}

async function duplicateJob(jobId) {
  const job = state.data.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const body = {
    title: `${job.title} Copy`,
    clientId: job.clientId || state.data.clients[0]?.id,
    department: job.department || "",
    location: job.location || "",
    employmentType: job.employmentType || "Full time",
    status: "draft",
    priority: job.priority || "Medium",
    clearance: job.clearance || "No clearance",
    startDate: job.startDate || "",
    closingDate: job.closingDate || "",
    skills: (job.skills || []).join(", "),
    description: job.description || ""
  };
  const result = await api("/api/jobs", { method: "POST", body: JSON.stringify(body) });
  await applyServerState(result);
  toast("Job duplicated as draft");
}

async function closeJob(jobId) {
  const job = state.data.jobs.find((item) => item.id === jobId);
  if (!job) return;
  const body = {
    title: job.title,
    clientId: job.clientId || state.data.clients[0]?.id,
    department: job.department || "",
    location: job.location || "",
    employmentType: job.employmentType || "Full time",
    status: "closed",
    priority: job.priority || "Medium",
    clearance: job.clearance || "No clearance",
    startDate: job.startDate || "",
    closingDate: job.closingDate || "",
    skills: (job.skills || []).join(", "),
    description: job.description || ""
  };
  const result = await api(`/api/jobs/${jobId}`, { method: "PATCH", body: JSON.stringify(body) });
  await applyServerState(result);
  toast("Job closed");
}

function renderPipeline() {
  const openJobs = state.data.jobs.filter((job) => job.status === "open");
  if (!state.pipelineJobId) state.pipelineJobId = openJobs[0]?.id || state.data.jobs[0]?.id || "";
  $("#pipelineJob").innerHTML = state.data.jobs.map((job) => `<option value="${job.id}" ${job.id === state.pipelineJobId ? "selected" : ""}>${job.title}</option>`).join("");
  if ($("#pipelineSearch")) $("#pipelineSearch").value = state.pipelineSearch;
  const selectedJob = state.data.jobs.find((job) => job.id === state.pipelineJobId);
  const existingIds = new Set(state.data.applications.filter((app) => app.jobId === state.pipelineJobId).map((app) => app.candidateId));
  const pipelineQueryRaw = state.pipelineSearch.trim();
  const pipelineQuery = pipelineQueryRaw.toLowerCase();
  const bestMatches = (state.recommendations?.jobMatches || [])
    .find((job) => job.jobId === state.pipelineJobId)?.topCandidates
    ?.filter((candidate) => !existingIds.has(candidate.candidateId)) || [];

  const suggestions = bestMatches.slice(0, 6);
  const suggestionsHtml = `
    <section class="pipeline-suggestions">
      <div class="panel-head">
        <div>
          <h2>AI Best Match Suggestions</h2>
          <span>Drag a suggested candidate into Applied or add them directly to start the workflow</span>
        </div>
        <span class="badge">${suggestions.length} suggested</span>
      </div>
      <div class="suggestion-rail">
        ${suggestions.map((candidate) => bestMatchCard(candidate, selectedJob)).join("") || `<div class="empty-inline">No new AI suggestions for this job.</div>`}
      </div>
    </section>
  `;

  const boardHtml = pipelineStages.map((stage) => {
    const apps = state.data.applications
      .filter((app) => app.jobId === state.pipelineJobId && normalizeStageName(app.stage) === stage)
      .filter((app) => {
        if (!pipelineQueryRaw) return true;
        const text = [
          app.candidate?.name,
          app.candidate?.currentRole,
          app.candidate?.location,
          ...(app.candidate?.skills || []),
          app.candidate?.resumeText || ""
        ].join(" ");
        return isBooleanLike(pipelineQueryRaw) ? evaluateBoolean(pipelineQueryRaw, text).matched : text.toLowerCase().includes(pipelineQuery);
      })
      .sort((a, b) => Number(b.matchScore || 0) - Number(a.matchScore || 0) || new Date(b.appliedAt || 0) - new Date(a.appliedAt || 0));
    return `
      <section class="kanban-col" data-drop-stage="${stage}">
        <h3><span>${stageLabels[stage] || stage}</span><strong>${apps.length}</strong></h3>
        ${apps.map((app) => appCard(app)).join("")}
        ${apps.length ? "" : `<div class="muted">No candidates</div>`}
      </section>
    `;
  }).join("");

  $("#pipelineBoard").innerHTML = `${suggestionsHtml}<div class="kanban-grid">${boardHtml}</div>`;
}

function appCard(app) {
  const normalizedStage = normalizeStageName(app.stage);
  const idx = pipelineStages.indexOf(normalizedStage);
  const isFinal = normalizedStage === "Final Decision";
  const candidate = app.candidate || {};
  const openToWork = inferOpenToWork(candidate, null);
  const timeline = `${stageLabels[normalizedStage] || normalizedStage} since ${formatDate(app.updatedAt || app.appliedAt)}`;
  const interviewInfo = normalizedStage === "Interview"
    ? `<div class="pipeline-card-row"><span>Interview</span><strong>${escapeHtml(app.interviewAt ? formatDate(app.interviewAt) : "Schedule pending")}</strong></div><div class="pipeline-card-row"><span>Status</span><strong>${escapeHtml(app.interviewStatus || "Not scheduled")}</strong></div>`
    : "";
  const matchBreakdown = normalizedStage === "Matched Candidates"
    ? `<div class="ai-match-breakdown"><span>AI fit</span><strong>${app.matchScore}%</strong><small>${(candidate.skills || []).slice(0, 3).map(escapeHtml).join(" + ") || "Skills and role alignment"}</small></div>`
    : "";
  return `
    <article class="app-card" draggable="true" data-drag-app="${app.id}">
      <div class="pipeline-card-head">
        <button class="link-button" data-preview="${app.candidateId}">${escapeHtml(candidate.name || "Unknown Candidate")}</button>
        <button class="icon-action pipeline-remove" data-confirm-remove="${app.id}" data-role-restricted="pipeline" title="Remove candidate" aria-label="Remove candidate">${icon("trash")}</button>
        <strong>${app.matchScore}%</strong>
      </div>
      <small>${escapeHtml(candidate.currentRole || "Candidate")}</small>
      <div class="pipeline-card-row"><span>Applied</span><strong>${formatDate(app.appliedAt)}</strong></div>
      <div class="pipeline-card-row"><span>Open to work</span><strong>${openToWork ? "Yes" : "No"}</strong></div>
      ${interviewInfo}
      ${matchBreakdown}
      <div class="candidate-timeline">${escapeHtml(timeline)}</div>
      <div class="skills"><span class="skill score">${app.matchScore}% match</span>${app.decision ? `<span class="skill">${escapeHtml(app.decision)}</span>` : ""}</div>
      <div class="stage-actions">
        ${idx > 0 ? `<button data-move="${app.id}" data-stage="${pipelineStages[idx - 1]}" data-role-restricted="pipeline">Back</button>` : ""}
        ${idx < pipelineStages.length - 1 ? `<button data-move="${app.id}" data-stage="${pipelineStages[idx + 1]}" data-role-restricted="pipeline">Move to ${stageLabels[pipelineStages[idx + 1]] || pipelineStages[idx + 1]}</button>` : ""}
        ${isFinal ? `<button class="selected-action ${app.decision === "Selected" ? "active" : ""}" data-decision="${app.id}" data-result="Selected" data-role-restricted="pipeline">Mark Selected</button><button class="rejected-action ${app.decision === "Rejected" ? "active" : ""}" data-decision="${app.id}" data-result="Rejected" data-role-restricted="pipeline">Mark Rejected</button>` : ""}
      </div>
    </article>
  `;
}

function bestMatchCard(candidate, job) {
  return `
    <article class="app-card best-match" draggable="true" data-drag-candidate="${candidate.candidateId}">
      <button class="link-button" data-preview="${candidate.candidateId}">${escapeHtml(candidate.name)}</button>
      <small>${escapeHtml(job?.title || "Selected job")}</small>
      <div class="skills"><span class="skill score">${candidate.score}% match</span><span class="skill">${candidate.recommendation}</span>${(candidate.gaps || []).slice(0, 2).map((gap) => `<span class="skill">Missing ${gap}</span>`).join("")}</div>
      <div class="stage-actions">
        <button class="primary-mini" data-add-to-job="${candidate.candidateId}" data-job="${state.pipelineJobId}" data-stage="Applied">Add to Applied</button>
      </div>
    </article>
  `;
}

function renderClients() {
  // Reserved for beta service cards rendered by renderSystemStatus().
}

function renderSystemStatus() {
  if (!state.systemStatus || !$("#systemCards")) return;
  const items = [
    ["Parser", state.systemStatus.parser],
    ["File Storage", state.systemStatus.storage],
    ["Image OCR", state.systemStatus.ocr],
    ["Email", state.systemStatus.email],
    ["ATS Intelligence", state.systemStatus.ai]
  ];
  $("#systemCards").innerHTML = items.map(([title, item]) => `
    <div>
      <strong>${title}</strong>
      <span>${item.label}</span>
      <em class="${item.status === "ready" || item.status === "available" || item.status === "configured" ? "ok" : "warn"}">${item.status}</em>
    </div>
  `).join("");
  $("#systemCheckedAt").textContent = new Date(state.systemStatus.generatedAt).toLocaleTimeString();
  $("#aiStatusBadge").textContent = state.systemStatus.ai.status === "configured" ? "AI connected" : "AI local ranking";
}

function renderAiSnapshot() {
  const box = $("#aiStats");
  if (!box || !state.data || !state.dashboard) return;
  const top = state.recommendations?.topCandidates?.[0];
  const openJobs = state.data.jobs.filter((job) => job.status === "open").length;
  const readableResumes = state.data.websiteResumes.filter((resume) => !resume.processed && resume.extractionQuality !== "poor").length;
  const attention = state.recommendations?.attention?.length || 0;
  box.innerHTML = [
    ["Top fit", top ? `${top.name} (${top.score}%)` : "Waiting"],
    ["Open jobs", openJobs],
    ["Ready resumes", readableResumes],
    ["Alerts", attention]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
}

function countBy(items, getKey) {
  return items.reduce((acc, item) => {
    const key = getKey(item) || "Not recorded";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function inferVisa(candidate) {
  const text = normalizeText(`${candidate.visaStatus || ""} ${candidate.workRights || ""} ${candidate.resumeText || ""} ${candidate.aiSummary || ""}`);
  if (text.includes("australian citizen") || text.includes("citizen")) return "Australian Citizen";
  if (text.includes("permanent resident")) return "Permanent Resident";
  if (text.includes("student visa")) return "Student Visa";
  if (text.includes("sponsorship")) return "Sponsorship Required";
  if (text.includes("work rights") || text.includes("full work")) return "Full Work Rights";
  return "Needs Verification";
}

function inferClearance(candidate) {
  const text = normalizeText(`${candidate.clearance || ""} ${candidate.securityClearance || ""} ${candidate.resumeText || ""} ${candidate.aiSummary || ""}`);
  if (text.includes("tspv")) return "TSPV";
  if (text.includes("nv2")) return "NV2";
  if (text.includes("nv1")) return "NV1";
  if (text.includes("baseline")) return "Baseline";
  if (text.includes("clearance")) return "Clearance";
  return "No Clearance";
}

function renderOutreach() {
  if (!$("#outreachTargets")) return;
  renderOutreachCandidateOptions();
  const type = $("#outreachType")?.value || "individual";
  const isBulkMode = type !== "individual";

  // Toggle section visibility
  const indivSec = $("#outreachIndividualSection");
  const bulkSec = $("#outreachBulkSection");
  if (indivSec) indivSec.classList.toggle("visible", !isBulkMode);
  if (bulkSec) bulkSec.classList.toggle("visible", isBulkMode);
  if ($("#followupPanel")) $("#followupPanel").hidden = type !== "follow-up";

  // Bulk candidate list rendering
  if (isBulkMode && $("#outreachCandidateList")) {
    const all = state.data.candidates;
    $("#outreachCandidateList").innerHTML = all.length ? all.map((c) => `
      <label class="outreach-candidate-item${state.selectedCandidates.has(c.id) ? " selected" : ""}">
        <input type="checkbox" data-outreach-candidate="${c.id}" ${state.selectedCandidates.has(c.id) ? "checked" : ""}/>
        <span>
          <strong>${escapeHtml(c.name)}</strong>
          <span>${escapeHtml(c.currentRole || "")}${c.email ? " · " + escapeHtml(c.email) : ""}</span>
        </span>
      </label>
    `).join("") : `<div class="empty-inline">No candidates yet. Add candidates from Resume Management.</div>`;
    const selectedCount = [...state.selectedCandidates].filter(id => all.find(c => c.id === id)).length;
    if ($("#outreachBulkCount")) $("#outreachBulkCount").textContent = selectedCount + " selected";
    if ($("#outreachRecipientsBulk")) {
      const names = [...state.selectedCandidates].map(id => all.find(c => c.id === id)?.name).filter(Boolean);
      $("#outreachRecipientsBulk").textContent = names.length
        ? `${names.length} recipient(s): ${names.slice(0, 4).join(", ")}${names.length > 4 ? " ..." : ""}`
        : "Select candidates below or from the Candidates tab.";
    }
  }

  const selected = [...state.selectedCandidates]
    .map((id) => state.data.candidates.find((candidate) => candidate.id === id))
    .filter(Boolean);
  const individual = getOutreachIndividualCandidate();
  if ($("#outreachRecipients")) $("#outreachRecipients").textContent = selected.length
    ? `${selected.length} recipient(s): ${selected.slice(0, 3).map((candidate) => candidate.name).join(", ")}${selected.length > 3 ? "..." : ""}`
    : individual ? `1 recipient: ${individual.name}` : "Choose an individual candidate, type a name, or select candidates for bulk.";

  const top = state.recommendations?.topCandidates || [];
  $("#outreachTargets").innerHTML = top.slice(0, 6).map((candidate) => `
    <div class="rank-row">
      <div>
        <strong>${escapeHtml(candidate.name)}</strong>
        <span>${escapeHtml(candidate.bestJob)} · ${candidate.score}% match</span>
      </div>
      <div class="row-actions">
        <button data-preview="${candidate.candidateId}">Preview</button>
        <button data-email-candidate="${candidate.candidateId}">Email</button>
      </div>
    </div>
  `).join("") || `<div class="activity">No outreach targets yet.</div>`;

  $("#outreachLog").innerHTML = state.data.outreachLog.slice(-8).reverse().map((item) => `
    <div class="activity">
      <strong>${escapeHtml(item.candidateName || "Candidate")}</strong> · ${escapeHtml(item.subject || "Outreach")}
      <time>${escapeHtml(item.status || "queued")} · ${new Date(item.createdAt).toLocaleString()}</time>
    </div>
  `).join("") || `<div class="activity">No communication history yet.</div>`;

  const log = state.data.outreachLog;
  const analytics = {
    sent: log.filter((item) => item.status === "sent").length,
    queued: log.filter((item) => item.status === "queued").length,
    failed: log.filter((item) => item.status === "failed").length,
    missing: log.filter((item) => item.status === "missing-email").length
  };
  if ($("#outreachAnalytics")) {
    $("#outreachAnalytics").innerHTML = `
      <div><span>Sent</span><strong>${analytics.sent}</strong></div>
      <div><span>Queued</span><strong>${analytics.queued}</strong></div>
      <div><span>Failed</span><strong>${analytics.failed}</strong></div>
      <div><span>Missing Email</span><strong>${analytics.missing}</strong></div>
    `;
  }

  const followups = [...(state.data.outreachFollowups || [])].reverse();
  if ($("#followupHistory")) {
    $("#followupHistory").innerHTML = followups.length ? followups.slice(0, 15).map((followup) => `
      <div class="activity">
        <strong>${escapeHtml(followup.candidateName)}</strong> · ${escapeHtml(followup.subject)}
        <time>${escapeHtml(followup.status)} · ${followup.status === "scheduled" ? `Due ${formatDate(followup.scheduledFor)}` : formatDate(followup.sentAt || followup.createdAt)}</time>
        ${followup.status === "scheduled" && canEdit("outreach") ? `<button data-cancel-followup="${followup.id}" class="secondary" style="margin-top:6px">Cancel</button>` : ""}
      </div>
    `).join("") : `<div class="activity">No follow-ups scheduled yet.</div>`;
  }
}

function renderOutreachCandidateOptions() {
  if (!$("#outreachCandidate")) return;
  const current = $("#outreachCandidate").value;
  $("#outreachCandidate").innerHTML = `<option value="">Choose candidate</option>${state.data.candidates.map((candidate) => (
    `<option value="${candidate.id}" ${candidate.id === current ? "selected" : ""}>${escapeHtml(candidate.name)}${candidate.email ? ` · ${escapeHtml(candidate.email)}` : ""}</option>`
  )).join("")}`;
  $("#candidateNameList").innerHTML = state.data.candidates.map((candidate) => `<option value="${escapeHtml(candidate.name)}"></option>`).join("");
}

function getOutreachIndividualCandidate() {
  const selectedId = $("#outreachCandidate")?.value || "";
  const typedName = normalizeText($("#outreachCandidateSearch")?.value || "");
  return state.data.candidates.find((candidate) => candidate.id === selectedId)
    || state.data.candidates.find((candidate) => normalizeText(candidate.name) === typedName)
    || state.data.candidates.find((candidate) => typedName && normalizeText(candidate.name).includes(typedName));
}

function renderReports() {
  if (!$("#reportKpis")) return;
  const apps = state.data.applications;
  const selected = apps.filter((app) => app.decision === "Selected" || (app.stage === "Final Decision" && app.decision !== "Rejected")).length;
  const rejected = apps.filter((app) => app.decision === "Rejected").length;
  const emails = state.data.outreachLog.length;
  const queuedOrSent = state.data.outreachLog.filter((item) => ["sent", "queued"].includes(item.status)).length;
  const bestMatches = apps.filter((app) => Number(app.matchScore || 0) >= 85).length;
  const responseRate = emails ? Math.round((queuedOrSent / emails) * 100) : 0;
  const reportItems = [
    ["Matched Candidates", bestMatches],
    ["Awaiting Decisions", apps.filter((app) => app.stage === "Awaiting Decision").length],
    ["Selected", selected],
    ["Rejected", rejected],
    ["Outreach Sent", queuedOrSent],
    ["Response Readiness", `${responseRate}%`],
    ["Conversion", `${apps.length ? Math.round((selected / apps.length) * 100) : 0}%`]
  ];
  $("#reportKpis").innerHTML = reportItems.map(([label, value]) => `<div class="kpi"><span>${label}</span><strong>${value}</strong></div>`).join("");

  const max = Math.max(...Object.values(state.dashboard.stageCounts), 1);
  $("#reportFunnel").innerHTML = stages.map((stage) => {
    const count = state.dashboard.stageCounts[stage] || 0;
    return `<div class="stage-row"><span>${stage}</span><div class="bar"><div style="width:${(count / max) * 100}%"></div></div><strong>${count}</strong></div>`;
  }).join("");

  const users = state.data.users.length ? state.data.users : [{ name: "ASJ Recruiter", role: "admin" }];
  $("#recruiterScorecard").innerHTML = `
    <div class="table-wrap ats-table-wrap scorecard-table-wrap">
      <table class="ats-table dense-grid scorecard-table">
        <thead><tr><th>Recruiter</th><th>Role</th><th>Reviewed</th><th>Selected</th><th>Outreach</th><th>Conversion</th></tr></thead>
        <tbody>
          ${users.map((user) => `
            <tr>
              <td><strong>${escapeHtml(user.name)}</strong></td>
              <td>${escapeHtml(user.role || "Recruiter")}</td>
              <td>${apps.length}</td>
              <td>${selected}</td>
              <td>${queuedOrSent}</td>
              <td>${apps.length ? Math.round((selected / apps.length) * 100) : 0}%</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;

  $("#aiAnalytics").innerHTML = [
    ["Profiles parsed", state.data.candidates.length],
    ["Matches generated", apps.length],
    ["Average match", `${state.dashboard.kpis.avgMatch}%`],
    ["Strong matches", bestMatches]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
  $("#reportsOutreachAnalytics").innerHTML = [
    ["Emails logged", emails],
    ["Sent or queued", queuedOrSent],
    ["Failed or missing", state.data.outreachLog.filter((item) => ["failed", "missing-email"].includes(item.status)).length],
    ["Awaiting Decision queue", apps.filter((app) => app.stage === "Awaiting Decision").length]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function downloadReportPdf() {
  const generated = new Date().toLocaleString();
  const apps = state.data.applications;
  const selected = apps.filter((app) => app.decision === "Selected" || (app.stage === "Final Decision" && app.decision !== "Rejected")).length;
  const rejected = apps.filter((app) => app.decision === "Rejected").length;
  const outreach = state.data.outreachLog.length;
  const strongMatches = apps.filter((app) => Number(app.matchScore || 0) >= 85).length;
  const kpis = [
    ["Candidates", state.data.candidates.length],
    ["Open Jobs", state.data.jobs.filter((job) => job.status === "open").length],
    ["Applications", apps.length],
    ["Average Match", `${state.dashboard.kpis.avgMatch}%`],
    ["Strong Matches", strongMatches],
    ["Selected", selected],
    ["Rejected", rejected],
    ["Outreach", outreach]
  ];
  const stageRows = stages.map((stage) => [stageLabels[stage] || stage, state.dashboard.stageCounts[stage] || 0]);
  const recruiterRows = (state.data.users.length ? state.data.users : [{ name: "ASJ Recruiter", role: "admin" }])
    .map((user) => [user.name, user.role || "Recruiter", apps.length, selected, outreach, `${apps.length ? Math.round((selected / apps.length) * 100) : 0}%`]);
  const topRows = (state.recommendations?.topCandidates || []).slice(0, 8)
    .map((candidate) => [candidate.name, candidate.role || "Candidate", candidate.bestJob || "", `${candidate.score || 0}%`, (candidate.skills || []).slice(0, 4).join(", ")]);
  const table = (headers, rows) => `
    <table>
      <thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((item) => `<td>${escapeHtml(item)}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
  const html = `
    <html>
      <head>
        <title>ASJ ATS Recruitment Report</title>
        <style>
          @page { size: A4; margin: 18mm; }
          * { box-sizing: border-box; }
          body { font-family: Arial, sans-serif; color: #111827; margin: 0; line-height: 1.45; }
          header { border-bottom: 3px solid #0097a7; padding-bottom: 14px; margin-bottom: 20px; }
          h1 { margin: 0 0 5px; font-size: 26px; }
          h2 { margin: 24px 0 8px; font-size: 16px; color: #0f172a; }
          .meta { color: #64748b; font-size: 12px; }
          .summary { border: 1px solid #d9e1ea; background: #f8fafc; border-radius: 8px; padding: 12px; margin: 14px 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: avoid; }
          th, td { border: 1px solid #d9e1ea; padding: 7px 8px; text-align: left; font-size: 11px; vertical-align: top; }
          th { background: #eef6f8; text-transform: uppercase; color: #475569; letter-spacing: .04em; }
          .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
          .kpi { border: 1px solid #d9e1ea; background: #ffffff; padding: 10px; border-radius: 6px; }
          .kpi span { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; }
          .kpi strong { display: block; margin-top: 4px; font-size: 20px; }
          footer { position: fixed; bottom: 0; left: 0; right: 0; color: #94a3b8; font-size: 10px; text-align: center; }
        </style>
      </head>
      <body>
        <header>
          <h1>ASJ Recruitment ATS Report</h1>
          <div class="meta">Generated ${generated} · ASJ Recruitment ATS</div>
        </header>
        <h2>Executive Summary</h2>
        <div class="summary">This report summarizes active recruitment performance, candidate matching, hiring funnel status, recruiter productivity, and outreach activity for management review.</div>
        <div class="kpis">${kpis.map(([label, value]) => `<div class="kpi"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>
        <h2>Hiring Funnel</h2>
        ${table(["Stage", "Candidates"], stageRows)}
        <h2>Recruiter Scorecard</h2>
        ${table(["Recruiter", "Role", "Reviewed", "Selected", "Outreach", "Conversion"], recruiterRows)}
        <h2>AI Match Analytics</h2>
        ${table(["Candidate", "Role", "Best Job", "Match", "Matched Skills"], topRows)}
        <h2>Outreach Analytics</h2>
        ${table(["Metric", "Value"], [["Emails logged", outreach], ["Sent or queued", state.data.outreachLog.filter((item) => ["sent", "queued"].includes(item.status)).length], ["Failed or missing", state.data.outreachLog.filter((item) => ["failed", "missing-email"].includes(item.status)).length]])}
        <footer>ASJ Recruitment ATS · Confidential management report</footer>
      </body>
    </html>
  `;
  const win = window.open("", "_blank");
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

const COMPLIANCE_STATUS_LABELS = {
  verified: "Verified", pending: "Pending", review_required: "Review Required",
  expired: "Expired", missing: "Missing Documents"
};

function documentEffectiveStatus(doc) {
  if (doc.expiryDate) {
    const expiry = new Date(doc.expiryDate);
    if (!Number.isNaN(expiry.valueOf()) && expiry.getTime() < Date.now()) return "expired";
  }
  return doc.status || "submitted";
}

function documentIsExpiringSoon(doc) {
  if (!doc.expiryDate) return false;
  const expiry = new Date(doc.expiryDate);
  if (Number.isNaN(expiry.valueOf())) return false;
  const daysLeft = (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return daysLeft >= 0 && daysLeft <= 30;
}

function candidateComplianceStatus(candidate) {
  const docs = candidate.complianceDocuments || [];
  if (!docs.length) return "missing";
  const statuses = docs.map(documentEffectiveStatus);
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("review_required")) return "review_required";
  if (statuses.every((status) => status === "verified")) return "verified";
  return "pending";
}

function renderCompliance() {
  if (!$("#visaCards")) return;
  const candidates = state.data.candidates;
  const visaCounts = countBy(candidates, inferVisa);
  const clearanceCounts = countBy(candidates, inferClearance);
  $("#visaCards").innerHTML = ["Australian Citizen", "Permanent Resident", "Full Work Rights", "Student Visa", "Sponsorship Required", "Needs Verification"]
    .map((label) => `<div><span>${label}</span><strong>${visaCounts[label] || 0}</strong></div>`).join("");
  $("#clearanceCards").innerHTML = ["No Clearance", "Baseline", "NV1", "NV2", "TSPV", "Clearance"]
    .map((label) => `<div><span>${label}</span><strong>${clearanceCounts[label] || 0}</strong></div>`).join("");

  const summary = { verified: 0, pending: 0, missing: 0, expired: 0, expiringSoon: 0 };
  candidates.forEach((candidate) => {
    const status = candidateComplianceStatus(candidate);
    if (status === "verified") summary.verified += 1;
    else if (status === "expired") summary.expired += 1;
    else if (status === "missing") summary.missing += 1;
    else summary.pending += 1;
    if ((candidate.complianceDocuments || []).some(documentIsExpiringSoon)) summary.expiringSoon += 1;
  });
  $("#complianceSummaryCards").innerHTML = `
    <div><span>Verified</span><strong>${summary.verified}</strong></div>
    <div><span>Pending Review</span><strong>${summary.pending}</strong></div>
    <div><span>Missing Documents</span><strong>${summary.missing}</strong></div>
    <div><span>Expired</span><strong>${summary.expired}</strong></div>
    <div><span>Expiring Soon</span><strong>${summary.expiringSoon}</strong></div>
  `;

  const filters = state.complianceFilters || { search: "", status: "", visa: "", clearance: "", expiry: "" };
  const search = filters.search.trim().toLowerCase();
  const filtered = candidates.filter((candidate) => {
    if (search && !candidate.name.toLowerCase().includes(search)) return false;
    if (filters.status && candidateComplianceStatus(candidate) !== filters.status) return false;
    if (filters.visa && inferVisa(candidate) !== filters.visa) return false;
    if (filters.clearance && inferClearance(candidate) !== filters.clearance) return false;
    const docs = candidate.complianceDocuments || [];
    if (filters.expiry === "expiring" && !docs.some(documentIsExpiringSoon)) return false;
    if (filters.expiry === "expired" && !docs.some((doc) => documentEffectiveStatus(doc) === "expired")) return false;
    return true;
  });

  $("#complianceRows").innerHTML = filtered.slice(0, 60).map((candidate) => {
    const status = candidateComplianceStatus(candidate);
    const docs = candidate.complianceDocuments || [];
    return `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(candidate.name)}</strong>
          <div class="muted">${escapeHtml(candidate.currentRole || "Candidate")} · ${escapeHtml(candidate.location || "Location not set")}</div>
        </div>
        <span class="badge ${status}">${COMPLIANCE_STATUS_LABELS[status]}</span>
      </div>
      <div class="job-meta">
        <span>${inferVisa(candidate)}</span>
        <span>${inferClearance(candidate)}</span>
        <span>${docs.length} document${docs.length === 1 ? "" : "s"}</span>
      </div>
      <div class="card-actions">
        <button data-manage-compliance="${candidate.id}">Manage Documents</button>
        <button data-preview="${candidate.id}">Open Profile</button>
      </div>
    </article>
  `;
  }).join("") || `<div class="activity">No candidates match these filters.</div>`;
}

function openComplianceManager(candidateId) {
  const candidate = state.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;
  const docs = candidate.complianceDocuments || [];
  const canManage = canEdit("compliance");
  $("#candidatePreviewName").textContent = `${candidate.name} — Compliance`;
  $("#candidatePreviewMeta").textContent = `${COMPLIANCE_STATUS_LABELS[candidateComplianceStatus(candidate)]} · ${docs.length} document${docs.length === 1 ? "" : "s"}`;
  $("#candidatePreviewBody").innerHTML = `
    <div class="candidate-profile">
      <section>
        <h3>Documents</h3>
        <div class="compliance-doc-list">
          ${docs.length ? docs.map((doc) => {
            const effective = documentEffectiveStatus(doc);
            const expiringSoon = documentIsExpiringSoon(doc);
            return `
            <div class="compliance-doc-row">
              <div class="doc-meta">
                <strong>${escapeHtml(doc.type)} <span class="badge ${effective}">${COMPLIANCE_STATUS_LABELS[effective] || effective}</span>${expiringSoon ? `<span class="badge review_required">Expiring Soon</span>` : ""}</strong>
                <span>${escapeHtml(doc.fileName)} · Uploaded ${formatDate(doc.uploadedAt)}${doc.expiryDate ? ` · Expires ${formatDate(doc.expiryDate)}` : ""}</span>
                ${doc.notes ? `<span>${escapeHtml(doc.notes)}</span>` : ""}
                <div class="compliance-timeline">${(doc.timeline || []).map((event) => `<span>${escapeHtml(event.event)} — ${formatDate(event.at)} by ${escapeHtml(event.by || "Unknown")}</span>`).join("")}</div>
              </div>
              <div class="doc-actions">
                <a class="button-link" href="${doc.fileUrl}" target="_blank" rel="noreferrer">View</a>
                <a class="button-link" href="${doc.fileUrl}" download>Download</a>
                ${canManage ? `
                  ${effective !== "verified" ? `<button data-verify-doc="${doc.id}" data-candidate="${candidate.id}" class="primary-mini">Verify</button>` : ""}
                  <button data-flag-doc="${doc.id}" data-candidate="${candidate.id}" class="secondary">Flag for Review</button>
                  <button data-delete-doc="${doc.id}" data-candidate="${candidate.id}" class="danger">Delete</button>
                ` : ""}
              </div>
            </div>
          `;
          }).join("") : `<p class="muted">No documents uploaded yet.</p>`}
        </div>
      </section>
      ${canManage ? `
        <section>
          <h3>Upload Document</h3>
          <form id="complianceUploadForm" class="compliance-upload-form">
            <input type="hidden" name="candidateId" value="${candidate.id}" />
            <select name="type" required>
              ${["Passport", "Visa", "Work Authorization", "Security Clearance", "Police Verification", "Certification", "Other"].map((type) => `<option value="${type}">${type}</option>`).join("")}
            </select>
            <input type="date" name="expiryDate" title="Expiry date (optional)" />
            <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp" required />
            <button type="submit" class="primary-mini">Upload</button>
          </form>
        </section>
      ` : ""}
    </div>
  `;
  $("#previewModal").hidden = false;
}

async function uploadComplianceDocument(form) {
  const formData = new FormData(form);
  const submitButton = form.querySelector("button[type=submit]");
  if (submitButton) { submitButton.disabled = true; submitButton.textContent = "Uploading..."; }
  try {
    const result = await api("/api/compliance/documents", { method: "POST", body: formData });
    await applyServerState(result);
    toast("Document uploaded");
    openComplianceManager(formData.get("candidateId"));
  } catch (error) {
    toast(error.message || "Unable to upload document");
  } finally {
    if (submitButton) { submitButton.disabled = false; submitButton.textContent = "Upload"; }
  }
}

async function updateComplianceDocument(documentId, changes, candidateIdForRefresh) {
  try {
    const result = await api(`/api/compliance/documents/${documentId}`, { method: "PATCH", body: JSON.stringify(changes) });
    await applyServerState(result);
    toast("Document updated");
    if (candidateIdForRefresh) openComplianceManager(candidateIdForRefresh);
  } catch (error) {
    toast(error.message || "Unable to update document");
  }
}

async function deleteComplianceDocument(documentId, candidateIdForRefresh) {
  if (!confirm("Delete this document? This cannot be undone.")) return;
  try {
    const result = await api(`/api/compliance/documents/${documentId}`, { method: "DELETE" });
    await applyServerState(result);
    toast("Document deleted");
    if (candidateIdForRefresh) openComplianceManager(candidateIdForRefresh);
  } catch (error) {
    toast(error.message || "Unable to delete document");
  }
}

async function refreshSystemStatus() {
  state.systemStatus = await api("/api/system-status");
  renderSystemStatus();
  toast("System status refreshed");
}

function renderJobOptions() {
  const options = state.data.jobs.filter((job) => job.status === "open").map((job) => (
    `<option value="${job.id}">${job.title}</option>`
  )).join("");
  if ($("#outreachJob")) $("#outreachJob").innerHTML = options;
}

function tokenizeBoolean(query) {
  const tokens = [];
  const pattern = /"([^"]+)"|\(|\)|\bAND\b|\bOR\b|\bNOT\b|[^\s()]+/gi;
  let match;
  while ((match = pattern.exec(query))) tokens.push(match[1] || match[0]);
  return tokens;
}

function uniqueTerms(tokens) {
  return [...new Set(tokens.filter((token) => !["AND", "OR", "NOT", "(", ")"].includes(token.toUpperCase())).map((token) => token.toLowerCase()))];
}

function evaluateBoolean(query, text) {
  const tokens = tokenizeBoolean(query);
  const terms = uniqueTerms(tokens);
  let index = 0;
  const haystack = normalizeText(text);
  const hasTerm = (term) => haystack.includes(normalizeText(term));

  const parseExpression = () => {
    let value = parseTerm();
    while (tokens[index]?.toUpperCase() === "OR") {
      index += 1;
      value = parseTerm() || value;
    }
    return value;
  };
  const parseTerm = () => {
    let value = parseFactor();
    while (index < tokens.length && tokens[index] !== ")" && tokens[index]?.toUpperCase() !== "OR") {
      if (tokens[index]?.toUpperCase() === "AND") index += 1;
      value = parseFactor() && value;
    }
    return value;
  };
  const parseFactor = () => {
    if (tokens[index]?.toUpperCase() === "NOT") {
      index += 1;
      return !parseFactor();
    }
    if (tokens[index] === "(") {
      index += 1;
      const value = parseExpression();
      if (tokens[index] === ")") index += 1;
      return value;
    }
    const term = tokens[index++] || "";
    return hasTerm(term);
  };

  const matched = tokens.length ? parseExpression() : true;
  const matchedTerms = terms.filter(hasTerm);
  const missingTerms = terms.filter((term) => !hasTerm(term));
  const score = terms.length ? Math.round((matchedTerms.length / terms.length) * 100) : 100;
  return { matched, matchedTerms, missingTerms, score };
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+#.]+/g, " ").trim();
}

function evaluateCandidateBoolean(query) {
  state.booleanResults = new Map();
  if (query) {
    for (const candidate of state.data.candidates) {
      const jobs = state.data.applications.filter((app) => app.candidateId === candidate.id).map((app) => `${app.job?.title || ""} ${app.job?.client || ""}`).join(" ");
      const text = `${candidate.name} ${candidate.currentRole} ${candidate.location} ${candidate.experienceYears || 0} ${(candidate.skills || []).join(" ")} ${candidate.resumeText || ""} ${jobs}`;
      state.booleanResults.set(candidate.id, evaluateBoolean(query, text));
    }
  }
}

async function refreshResumeQueue() {
  if (!state.data) return;
  const queue = resumeQueueStats(state.data.websiteResumes || []);
  if (!queue.remaining && !queue.Parsing) return;
  try {
    const result = await api("/api/resume-queue");
    await applyServerState(result);
  } catch (error) {
    // Queue polling is non-critical; the next normal refresh will recover.
  }
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCandidates() {
  const candidates = applyCandidateFilters(state.data.candidates);
  const headers = ["Candidate Name", "Current Role", "Location", "Experience", "Match %", "Pipeline Stage", "Open To Work", "Last Activity"];
  const rows = candidates.map((candidate) => {
    const match = candidateBestMatch(candidate);
    const stage = candidatePipelineStage(candidate);
    return [
      candidate.name,
      candidate.currentRole || "",
      candidate.location || "",
      `${candidate.experienceYears || 0} yrs`,
      `${match.score || 0}%`,
      stageLabels[stage] || stage,
      inferOpenToWork(candidate, null) ? "Open To Work" : "Not listed",
      formatDate(candidate.updatedAt || candidate.createdAt)
    ];
  });
  downloadCsv("asj-candidates.csv", headers, rows);
}

function exportJobsReport() {
  const headers = ["Job Title", "Client", "Status", "Priority", "Location", "Employment Type", "Open Positions", "Applications", "Closing Date"];
  const rows = state.data.jobs.map((job) => [
    job.title, job.client || "", job.status || "", job.priority || "",
    job.location || "", job.employmentType || "",
    job.openings ?? job.positions ?? 1,
    state.data.applications.filter((app) => app.jobId === job.id).length,
    job.closingDate || ""
  ]);
  downloadCsv("asj-jobs-report.csv", headers, rows);
}

function exportComplianceReport() {
  const headers = ["Candidate", "Compliance Status", "Visa", "Clearance", "Documents", "Expiring Soon", "Expired"];
  const rows = state.data.candidates.map((candidate) => {
    const docs = candidate.complianceDocuments || [];
    return [
      candidate.name,
      COMPLIANCE_STATUS_LABELS[candidateComplianceStatus(candidate)],
      inferVisa(candidate),
      inferClearance(candidate),
      docs.length,
      docs.filter(documentIsExpiringSoon).length,
      docs.filter((doc) => documentEffectiveStatus(doc) === "expired").length
    ];
  });
  downloadCsv("asj-compliance-report.csv", headers, rows);
}

function exportRecruiterReport() {
  const apps = state.data.applications;
  const selected = apps.filter((app) => app.decision === "Selected" || (app.stage === "Final Decision" && app.decision !== "Rejected")).length;
  const outreach = state.data.outreachLog.length;
  const headers = ["Recruiter", "Role", "Reviewed", "Selected", "Outreach", "Conversion"];
  const rows = (state.data.users.length ? state.data.users : [{ name: "ASJ Recruiter", role: "admin" }])
    .map((user) => [user.name, user.role || "Recruiter", apps.length, selected, outreach, `${apps.length ? Math.round((selected / apps.length) * 100) : 0}%`]);
  downloadCsv("asj-recruiter-report.csv", headers, rows);
}

function runCandidateBulkAction(action) {
  if (action === "email") {
    const ids = selectedCandidateIds();
    if (!ids.length) return toast("Select candidates first");
    openOutreachComposer(ids);
  }
  if (action === "delete") bulkDeleteCandidates();
  $("#candidateBulkAction").value = "";
}

async function syncResumes() {
  const result = await api("/api/sync-resumes", { method: "POST", body: JSON.stringify({ duplicateAction: $("#duplicateAction")?.value || "skip" }) });
  await applyServerState(result);
  toast(result.message || "Processing in background");
}

async function reparseResumes() {
  $("#reparseBtn").disabled = true;
  $("#reparseBtn").textContent = "Reading...";

  try {
    const result = await api("/api/reparse-resumes", { method: "POST", body: "{}" });
    await applyServerState(result);
    toast(`${result.reparsed.length} file(s) re-read, ${result.failed.length} failed`);
  } finally {
    $("#reparseBtn").disabled = false;
    $("#reparseBtn").textContent = "Re-read Uploaded Files";
  }
}

async function uploadResume() {
  const files = [...$("#resumeFile").files];
  if (!files.length) return toast("Choose one or more resume files first");

  const allowed = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"];
  if (files.some((file) => !allowed.some((ext) => file.name.toLowerCase().endsWith(ext)))) return toast("Only PDF, Word, and image resume files are allowed");
  if (files.some((file) => file.size > 10 * 1024 * 1024)) return toast("Each resume must be 10MB or smaller");

  let lastResult = null;
  $("#uploadResume").disabled = true;
  $("#uploadResume").textContent = "Uploading...";
  try {
    const form = new FormData();
    for (const file of files) {
      form.append("resume", file);
    }
    form.append("duplicateAction", $("#duplicateAction").value);
    if (files.length === 1) form.append("resumeText", $("#uploadText").value.trim());

    lastResult = await api("/api/upload-resumes", {
      method: "POST",
      body: form
    });

    await applyServerState(lastResult);
    $("#resumeFile").value = "";
    $("#uploadText").value = "";
    toast(lastResult.message || `✓ ${lastResult.imported?.length || files.length} resume(s) imported successfully`, "success");
  } finally {
    $("#uploadResume").disabled = false;
    $("#uploadResume").textContent = "Upload File(s)";
  }
}

async function extractJob() {
  const form = new FormData();
  const file = $("#jobFile").files[0];
  if (file) form.append("jobFile", file);
  form.append("jobUrl", $("#jobUrl").value.trim());
  form.append("jobRawText", $("#jobRawText").value.trim());
  $("#extractJob").disabled = true;
  $("#extractJob").textContent = "Extracting...";
  try {
    const result = await api("/api/extract-job", { method: "POST", body: form });
    const job = result.job;
    $("#jobTitle").value = job.title || "";
    $("#jobDepartment").value = job.department || "";
    $("#jobLocation").value = job.location || "";
    $("#jobType").value = job.employmentType || "Full time";
    $("#jobStatus").value = job.status || "open";
    $("#jobPriority").value = job.priority || "Medium";
    $("#jobClearance").value = job.clearance || "No clearance";
    $("#jobStartDate").value = /^\d{4}-\d{2}-\d{2}$/.test(job.startDate || "") ? job.startDate : "";
    $("#jobClosingDate").value = /^\d{4}-\d{2}-\d{2}$/.test(job.closingDate || "") ? job.closingDate : "";
    $("#jobSkills").value = (job.skills || []).join(", ");
    $("#jobDescription").value = job.description || "";
    $("#jobExtractResult").innerHTML = `<strong>Extracted:</strong> ${escapeHtml(job.title)} <span>${(job.skills || []).length} skill(s) found. Review and click Add Job.</span>`;
  } finally {
    $("#extractJob").disabled = false;
    $("#extractJob").textContent = "Extract to Form";
  }
}

async function importFolder() {
  const folderPath = $("#folderPath").value.trim();
  if (!folderPath) return toast("Enter the folder path containing resumes");

  $("#importFolder").disabled = true;
  $("#importFolder").textContent = "Importing...";

  try {
    const result = await api("/api/import-folder", {
      method: "POST",
      body: JSON.stringify({
        folderPath
      })
    });

    await applyServerState(result);
    $("#bulkResult").innerHTML = `
      <strong>${result.imported.length}</strong> imported from ${result.found} resume file(s).
      <span>${result.skipped.length} skipped · ${result.failed.length} failed</span>
      ${result.failed.length ? `<pre>${result.failed.slice(0, 5).map((item) => `${item.file}: ${item.error}`).join("\n")}</pre>` : ""}
    `;
    toast(`✓ ${result.imported.length} resume(s) imported to inbox`, "success");
  } finally {
    $("#importFolder").disabled = false;
    $("#importFolder").textContent = "Import Folder";
  }
}

async function createJob() {
  const body = {
    title: $("#jobTitle").value.trim(),
    clientId: state.data.clients[0]?.id,
    department: $("#jobDepartment").value.trim(),
    location: $("#jobLocation").value.trim(),
    employmentType: $("#jobType").value,
    status: $("#jobStatus").value,
    priority: $("#jobPriority").value,
    clearance: $("#jobClearance").value,
    startDate: $("#jobStartDate").value,
    closingDate: $("#jobClosingDate").value,
    skills: $("#jobSkills").value.trim(),
    description: $("#jobDescription").value.trim()
  };
  if (!body.title || !body.description) return toast("Add job title and description");
  const wasEditing = Boolean(state.editingJobId);
  const path = state.editingJobId ? `/api/jobs/${state.editingJobId}` : "/api/jobs";
  const method = "POST";

  $("#createJob").disabled = true;
  $("#createJob").textContent = wasEditing ? "Saving..." : "Adding...";
  try {
    const result = await api(path, { method, body: JSON.stringify(body) });
    await applyServerState(result);
    resetJobForm();
    toast(wasEditing ? "Job updated and matches refreshed" : "Job created and matched against active candidates");
  } catch (error) {
    toast(error.message || "Unable to save job");
    $("#createJob").textContent = wasEditing ? "Save Job" : "Add Job";
  } finally {
    $("#createJob").disabled = false;
  }
}

function editJob(jobId) {
  const job = state.data.jobs.find((item) => item.id === jobId);
  if (!job) return;
  state.editingJobId = job.id;
  $("#jobTitle").value = job.title || "";
  $("#jobDepartment").value = job.department || "";
  $("#jobLocation").value = job.location || "";
  $("#jobType").value = job.employmentType || "Full time";
  $("#jobStatus").value = job.status || "open";
  $("#jobPriority").value = job.priority || "Medium";
  $("#jobClearance").value = job.clearance || "No clearance";
  $("#jobStartDate").value = job.startDate || "";
  $("#jobClosingDate").value = job.closingDate || "";
  $("#jobSkills").value = (job.skills || []).join(", ");
  $("#jobDescription").value = job.description || "";
  $("#createJob").textContent = "Save Job";
  $("#cancelJobEdit").hidden = false;
  const details = $(".job-create-details");
  if (details) details.open = true;
  details?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetJobForm() {
  ["#jobTitle", "#jobDepartment", "#jobLocation", "#jobSkills", "#jobDescription", "#jobStartDate", "#jobClosingDate"].forEach((selector) => { $(selector).value = ""; });
  state.editingJobId = "";
  $("#createJob").textContent = "Add Job";
  $("#cancelJobEdit").hidden = true;
}

async function moveApplication(appId, stage) {
  const result = await api(`/api/applications/${appId}`, {
    method: "PATCH",
    body: JSON.stringify({ stage })
  });
  await applyServerState(result);
}

async function decideApplication(appId, decision) {
  const result = await api(`/api/applications/${appId}`, {
    method: "PATCH",
    body: JSON.stringify({ stage: "Final Decision", decision })
  });
  await applyServerState(result);
  toast(`Candidate marked ${decision}`);
}

async function addCandidateToJob(candidateId, jobId, stage = "Applied") {
  const result = await api("/api/applications", {
    method: "POST",
    body: JSON.stringify({ candidateId, jobId, stage })
  });
  await applyServerState(result);
  toast("Candidate added to job");
}

async function assignCandidateQuick(candidateId) {
  const jobId = state.pipelineJobId || state.data.jobs.find((job) => job.status === "open")?.id || state.data.jobs[0]?.id;
  if (!jobId) return toast("Create a job before assigning candidates");
  await addCandidateToJob(candidateId, jobId, "Applied");
}

function closeProfileMenu() {
  const menu = $("#sidebarProfileMenu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("#userChip")?.setAttribute("aria-expanded", "false");
}
function closeNotificationPanel() {
  const panel = $("#notificationPanel");
  if (panel) panel.hidden = true;
}
// Ensures only one of {profile menu, notification panel, settings overlay} is ever
// open at once -- each open action calls this first to close the others.
function closeAllOverlays({ exceptSettings = false } = {}) {
  closeProfileMenu();
  closeNotificationPanel();
  if (!exceptSettings) closeSettingsOverlay();
}

function openSettingsOverlay(category) {
  closeAllOverlays({ exceptSettings: true });
  if (category) {
    state.activeSettingsCategory = category;
    clearWorkingCategoryLists(category);
  }
  $("#settingsOverlay").hidden = false;
  document.body.classList.add("settings-open");
  renderSettings();
}
function closeSettingsOverlay() {
  $("#settingsOverlay").hidden = true;
  document.body.classList.remove("settings-open");
}
$("#closeSettingsOverlay").addEventListener("click", closeSettingsOverlay);
$("#settingsOverlay").addEventListener("click", (event) => {
  if (event.target.id === "settingsOverlay") closeSettingsOverlay();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#settingsOverlay") && !$("#settingsOverlay").hidden) closeSettingsOverlay();
});

// ═══════════════════════════════════════════════════════════════════════
// Settings module
// ═══════════════════════════════════════════════════════════════════════

let pendingConfirmAction = null;

function confirmDestructive(title, message, confirmLabel, onConfirm) {
  pendingConfirmAction = onConfirm;
  $("#candidatePreviewName").textContent = title;
  $("#candidatePreviewMeta").textContent = "";
  $("#candidatePreviewBody").innerHTML = `
    <div class="confirm-remove">
      <p>${escapeHtml(message)}</p>
      <div class="confirm-remove-actions">
        <button data-confirm-action-yes class="danger">${escapeHtml(confirmLabel)}</button>
        <button data-close-preview class="ghost-button">Cancel</button>
      </div>
    </div>
  `;
  $("#previewModal").hidden = false;
}

function settingsSectionHeader(title, description) {
  return `<div class="settings-section-header"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div>`;
}

async function saveSettingsCategory(category, payload, successMessage) {
  const btn = document.querySelector(`#settingsContent [data-save-category="${category}"]`);
  const original = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.innerHTML = `<span class="btn-spinner"></span> Saving...`; }
  try {
    const result = await api(`/api/settings/${category}`, { method: "PATCH", body: JSON.stringify(payload) });
    state.settingsData.settings[category] = result.values;
    toast(successMessage || "Settings saved", "success");
    renderSettings();
  } catch (error) {
    toast(error.message || "Failed to save settings", "error");
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

function settingsField(value) {
  if (value === undefined || value === null) return "";
  return escapeHtml(String(value));
}

// ── Nav + dispatcher ─────────────────────────────────────────────────
function renderSettings() {
  if (!$("#settingsNav")) return;
  const allowed = SETTINGS_CATEGORY_META.filter((cat) => canViewSettings(cat.id));
  if (!allowed.some((cat) => cat.id === state.activeSettingsCategory)) {
    state.activeSettingsCategory = allowed[0]?.id || "profile";
  }
  const groups = [];
  allowed.forEach((cat) => { if (!groups.includes(cat.group)) groups.push(cat.group); });
  $("#settingsNav").innerHTML = groups.map((group) => `
    <div class="settings-nav-group">
      <span class="settings-nav-group-label">${escapeHtml(group)}</span>
      ${allowed.filter((cat) => cat.group === group).map((cat) => `
        <button class="settings-nav-item ${state.activeSettingsCategory === cat.id ? "active" : ""}" data-settings-category="${cat.id}">
          <span class="settings-nav-icon">${cat.icon}</span>${escapeHtml(cat.label)}
        </button>
      `).join("")}
    </div>
  `).join("");

  const renderer = SETTINGS_RENDERERS[state.activeSettingsCategory];
  if (!state.settingsData.categories.length && state.activeSettingsCategory !== "users") {
    $("#settingsContent").innerHTML = `<div class="empty-state"><strong>Loading settings…</strong></div>`;
    return;
  }
  $("#settingsContent").innerHTML = renderer ? renderer() : `<div class="empty-state"><strong>Not available</strong><span>You don't have access to this section.</span></div>`;
}

// ── Profile ──────────────────────────────────────────────────────────
function renderProfileSettings() {
  const profile = state.profileData;
  if (!profile) return `<div class="empty-state"><strong>Loading…</strong></div>`;
  return `
    ${settingsSectionHeader("Profile Settings", "Your personal account details.")}
    <div class="settings-card">
      <div class="settings-avatar-row">
        <div class="settings-avatar">${profile.photoUrl ? `<img src="${settingsField(profile.photoUrl)}" alt="" />` : escapeHtml((profile.name || "?").slice(0, 1).toUpperCase())}</div>
        <div class="settings-grid" style="flex:1">
          <label>Photo URL<input id="settingsProfilePhoto" value="${settingsField(profile.photoUrl)}" placeholder="https://..." /></label>
          <label>Phone<input id="settingsProfilePhone" value="${settingsField(profile.phone)}" placeholder="+1 555 000 0000" /></label>
        </div>
      </div>
      <div class="settings-grid">
        <label>Full name<input value="${settingsField(profile.name)}" disabled title="Managed by your account administrator" /></label>
        <label>Email<input value="${settingsField(profile.email)}" disabled title="Managed by your account administrator" /></label>
        <label>Role<input value="${escapeHtml(ROLE_LABELS[profile.role] || profile.role)}" disabled /></label>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="profile" data-profile-save>Save profile</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Change password</h3>
      <p class="muted">Update the password used to sign in.</p>
      <div class="settings-grid">
        <label>Current password<input id="settingsCurrentPassword" type="password" autocomplete="current-password" /></label>
        <label>New password<input id="settingsNewPassword" type="password" autocomplete="new-password" /></label>
        <label>Confirm new password<input id="settingsConfirmPassword" type="password" autocomplete="new-password" /></label>
      </div>
      <div class="settings-actions">
        <button class="secondary" data-change-password>Update password</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Multi-factor authentication</h3>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsMfaToggle" ${profile.mfaEnabled ? "checked" : ""} /><span class="slider"></span></label>
        <div>
          <strong>${profile.mfaEnabled ? "MFA is enabled" : "MFA is disabled"}</strong>
          <span class="muted">Require a one-time code in addition to your password when signing in.</span>
        </div>
      </div>
    </div>
  `;
}

async function saveProfileSettings() {
  await saveProfileFields({
    photoUrl: $("#settingsProfilePhoto").value.trim(),
    phone: $("#settingsProfilePhone").value.trim()
  }, "Profile updated");
}

async function saveProfileFields(fields, message) {
  const btn = document.querySelector("[data-profile-save]");
  const original = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }
  try {
    const result = await api("/api/settings/profile", { method: "PATCH", body: JSON.stringify(fields) });
    state.profileData = { ...state.profileData, ...result };
    toast(message, "success");
    renderSettings();
  } catch (error) {
    toast(error.message || "Failed to update profile", "error");
    if (btn) { btn.disabled = false; btn.textContent = original; }
  }
}

async function changePassword() {
  const current = $("#settingsCurrentPassword").value;
  const next = $("#settingsNewPassword").value;
  const confirmValue = $("#settingsConfirmPassword").value;
  if (!current || !next) return toast("Enter your current and new password", "error");
  if (next.length < 8) return toast("New password must be at least 8 characters", "error");
  if (next !== confirmValue) return toast("New passwords don't match", "error");
  const btn = document.querySelector("[data-change-password]");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Updating...";
  try {
    await api("/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword: current, newPassword: next }) });
    toast("Password updated", "success");
    $("#settingsCurrentPassword").value = "";
    $("#settingsNewPassword").value = "";
    $("#settingsConfirmPassword").value = "";
  } catch (error) {
    toast(error.message || "Failed to update password", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function toggleMfa(enabled) {
  await saveProfileFields({ mfaEnabled: enabled }, enabled ? "MFA enabled" : "MFA disabled");
}

// ── Appearance ───────────────────────────────────────────────────────
function renderAppearanceSettings() {
  const s = state.settingsData.settings.appearance || {};
  return `
    ${settingsSectionHeader("Appearance", "Personalize how the workspace looks for you.")}
    <div class="settings-card">
      <h3>Theme</h3>
      <div class="theme-picker">
        <button class="theme-option ${s.theme !== "dark" ? "active" : ""}" data-appearance-theme="light">
          <span class="theme-swatch light"></span>Light
        </button>
        <button class="theme-option ${s.theme === "dark" ? "active" : ""}" data-appearance-theme="dark">
          <span class="theme-swatch dark"></span>Dark
        </button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Locale</h3>
      <div class="settings-grid">
        <label>Language
          <select id="settingsLanguage">
            <option value="en" ${s.language === "en" ? "selected" : ""}>English</option>
            <option value="es" ${s.language === "es" ? "selected" : ""}>Español</option>
            <option value="fr" ${s.language === "fr" ? "selected" : ""}>Français</option>
            <option value="hi" ${s.language === "hi" ? "selected" : ""}>हिन्दी</option>
          </select>
        </label>
        <label>Date format
          <select id="settingsDateFormat">
            <option value="DD/MM/YYYY" ${s.dateFormat === "DD/MM/YYYY" ? "selected" : ""}>DD/MM/YYYY</option>
            <option value="MM/DD/YYYY" ${s.dateFormat === "MM/DD/YYYY" ? "selected" : ""}>MM/DD/YYYY</option>
            <option value="YYYY-MM-DD" ${s.dateFormat === "YYYY-MM-DD" ? "selected" : ""}>YYYY-MM-DD</option>
          </select>
        </label>
        <label>Time format
          <select id="settingsTimeFormat">
            <option value="24h" ${s.timeFormat === "24h" ? "selected" : ""}>24-hour</option>
            <option value="12h" ${s.timeFormat === "12h" ? "selected" : ""}>12-hour</option>
          </select>
        </label>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="appearance" data-appearance-save>Save preferences</button>
      </div>
    </div>
  `;
}

function applyThemeFromSettings() {
  const theme = state.settingsData.settings.appearance?.theme || "light";
  document.documentElement.dataset.theme = theme;
}

async function setAppearanceTheme(theme) {
  document.documentElement.dataset.theme = theme; // instant feedback, no flash while saving
  await saveSettingsCategory("appearance", { theme }, "Theme updated");
}

function saveAppearancePreferences() {
  return saveSettingsCategory("appearance", {
    language: $("#settingsLanguage").value,
    dateFormat: $("#settingsDateFormat").value,
    timeFormat: $("#settingsTimeFormat").value
  }, "Preferences saved");
}

// ── Notifications ────────────────────────────────────────────────────
function renderNotificationSettings() {
  const s = state.settingsData.settings.notifications || {};
  return `
    ${settingsSectionHeader("Notifications", "Choose what you get notified about.")}
    <div class="settings-card">
      ${["emailOnNewCandidate:New candidate matches a job", "emailOnStageChange:Candidate moves pipeline stage", "emailOnInterviewScheduled:Interview scheduled", "inAppNotifications:In-app notification bell"].map((row) => {
        const [key, label] = row.split(":");
        return `
        <div class="settings-toggle-row">
          <label class="switch"><input type="checkbox" data-notif-toggle="${key}" ${s[key] ? "checked" : ""} /><span class="slider"></span></label>
          <div><strong>${escapeHtml(label)}</strong></div>
        </div>`;
      }).join("")}
      <div class="settings-grid">
        <label>Digest frequency
          <select id="settingsDigestFrequency">
            <option value="off" ${s.digestFrequency === "off" ? "selected" : ""}>Off</option>
            <option value="daily" ${s.digestFrequency === "daily" ? "selected" : ""}>Daily</option>
            <option value="weekly" ${s.digestFrequency === "weekly" ? "selected" : ""}>Weekly</option>
          </select>
        </label>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="notifications" data-notifications-save>Save notification preferences</button>
      </div>
    </div>
  `;
}

function saveNotificationSettings() {
  const payload = { digestFrequency: $("#settingsDigestFrequency").value };
  $$("[data-notif-toggle]").forEach((el) => { payload[el.dataset.notifToggle] = el.checked; });
  return saveSettingsCategory("notifications", payload, "Notification preferences saved");
}

// ── Recruitment ──────────────────────────────────────────────────────
function renderRecruitmentSettings() {
  const s = state.settingsData.settings.recruitment || {};
  const listEditor = (label, key, items) => `
    <div class="settings-list-editor">
      <strong>${escapeHtml(label)}</strong>
      <div class="settings-chip-list" data-list-key="${key}">
        ${(items || []).map((item, idx) => `<span class="settings-chip">${escapeHtml(item)}<button type="button" data-remove-chip="${key}:${idx}" aria-label="Remove">×</button></span>`).join("")}
      </div>
      <div class="settings-chip-add">
        <input type="text" placeholder="Add ${escapeHtml(label.toLowerCase())}..." data-chip-input="${key}" />
        <button type="button" class="secondary compact-button" data-add-chip="${key}">Add</button>
      </div>
    </div>
  `;
  const templateEditor = (label, key, templates) => `
    <div class="settings-list-editor">
      <strong>${escapeHtml(label)}</strong>
      <div class="settings-table-scroll">
        <table class="settings-mini-table">
        <thead><tr><th>Name</th><th>Body</th><th></th></tr></thead>
        <tbody>
          ${(templates || []).map((t) => `
            <tr>
              <td><input type="text" value="${settingsField(t.name)}" data-template-field="${key}:${t.id}:name" /></td>
              <td><textarea rows="2" data-template-field="${key}:${t.id}:body">${settingsField(t.body)}</textarea></td>
              <td><button class="icon-action danger" data-remove-template="${key}:${t.id}" title="Delete">${icon("trash")}</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      </div>
      <button type="button" class="secondary compact-button" data-add-template="${key}">+ Add template</button>
    </div>
  `;
  return `
    ${settingsSectionHeader("Recruitment Settings", "Pipeline stages, candidate statuses, and reusable templates.")}
    <div class="settings-card">
      ${listEditor("Pipeline stages", "pipelineStages", s.pipelineStages)}
    </div>
    <div class="settings-card">
      ${listEditor("Candidate statuses", "candidateStatuses", s.candidateStatuses)}
    </div>
    <div class="settings-card">
      ${templateEditor("Job templates", "jobTemplates", s.jobTemplates)}
    </div>
    <div class="settings-card">
      ${templateEditor("Offer templates", "offerTemplates", s.offerTemplates)}
    </div>
    <div class="settings-card">
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsAutoAdvance" ${s.autoAdvanceOnHighMatch ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Auto-shortlist high matches</strong><span class="muted">Automatically advance candidates above the score threshold.</span></div>
      </div>
      <label>Minimum match score for auto-shortlist
        <input id="settingsMinMatchScore" type="number" min="0" max="100" value="${settingsField(s.minMatchScoreForAutoShortlist)}" />
      </label>
      <div class="settings-actions">
        <button class="primary" data-save-category="recruitment" data-recruitment-save>Save recruitment settings</button>
      </div>
    </div>
  `;
}

// Generic chip-list state helpers shared by any category with array-of-strings fields
// (recruitment stages/statuses, resumeParsing formats, storage allowed types, etc.)
function getWorkingCategoryList(category, key) {
  state._workingLists ||= {};
  const cacheKey = `${category}.${key}`;
  if (!state._workingLists[cacheKey]) {
    state._workingLists[cacheKey] = [...(state.settingsData.settings[category]?.[key] || [])];
  }
  return state._workingLists[cacheKey];
}
function clearWorkingCategoryLists(category) {
  if (!state._workingLists) return;
  Object.keys(state._workingLists).forEach((k) => { if (k.startsWith(`${category}.`)) delete state._workingLists[k]; });
}

function saveRecruitmentSettings() {
  const payload = {
    pipelineStages: getWorkingCategoryList("recruitment", "pipelineStages"),
    candidateStatuses: getWorkingCategoryList("recruitment", "candidateStatuses"),
    jobTemplates: getWorkingCategoryList("recruitment", "jobTemplates"),
    offerTemplates: getWorkingCategoryList("recruitment", "offerTemplates"),
    autoAdvanceOnHighMatch: $("#settingsAutoAdvance").checked,
    minMatchScoreForAutoShortlist: Number($("#settingsMinMatchScore").value) || 0
  };
  return saveSettingsCategory("recruitment", payload, "Recruitment settings saved").then(() => clearWorkingCategoryLists("recruitment"));
}

// ── Client settings ──────────────────────────────────────────────────
function renderClientSettings() {
  const s = state.settingsData.settings.clients || {};
  return `
    ${settingsSectionHeader("Client Settings", "Defaults for how you work with hiring clients.")}
    <div class="settings-card">
      <div class="settings-grid">
        <label>Default client owner<input id="settingsDefaultClientOwner" value="${settingsField(s.defaultClientOwner)}" placeholder="Name" /></label>
        <label>Client billing contact<input id="settingsClientBillingContact" value="${settingsField(s.clientBillingContact)}" placeholder="billing@client.com" /></label>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsClientPortal" ${s.clientPortalEnabled ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Client portal enabled</strong><span class="muted">Let clients log in to view their own pipeline.</span></div>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsClientNotesVisible" ${s.clientNotesVisibleToClient ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Notes visible to client</strong><span class="muted">Show recruiter notes on shared candidate profiles.</span></div>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="clients" data-clients-save>Save client settings</button>
      </div>
    </div>
  `;
}
function saveClientSettings() {
  return saveSettingsCategory("clients", {
    defaultClientOwner: $("#settingsDefaultClientOwner").value.trim(),
    clientBillingContact: $("#settingsClientBillingContact").value.trim(),
    clientPortalEnabled: $("#settingsClientPortal").checked,
    clientNotesVisibleToClient: $("#settingsClientNotesVisible").checked
  }, "Client settings saved");
}

// ── Company ──────────────────────────────────────────────────────────
function renderCompanySettings() {
  const s = state.settingsData.settings.company || {};
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return `
    ${settingsSectionHeader("Company Settings", "Your organization's public details and working hours.")}
    <div class="settings-card">
      <div class="settings-grid">
        <label>Company name<input id="settingsCompanyName" value="${settingsField(s.companyName)}" /></label>
        <label>Logo URL<input id="settingsLogoUrl" value="${settingsField(s.logoUrl)}" placeholder="https://..." /></label>
        <label>Website<input id="settingsWebsite" value="${settingsField(s.website)}" /></label>
        <label>Support email<input id="settingsSupportEmail" value="${settingsField(s.supportEmail)}" /></label>
        <label>Phone<input id="settingsCompanyPhone" value="${settingsField(s.phone)}" /></label>
        <label>Brand color<input id="settingsBrandColor" type="color" value="${settingsField(s.brandColor || "#0d9488")}" /></label>
      </div>
      <label>Address<textarea id="settingsAddress" rows="2">${settingsField(s.address)}</textarea></label>
      <div class="settings-grid">
        <label>Timezone
          <select id="settingsTimezone">
            ${["Asia/Kolkata", "America/New_York", "America/Los_Angeles", "Europe/London", "Asia/Dubai", "Australia/Sydney"].map((tz) => `<option value="${tz}" ${s.timezone === tz ? "selected" : ""}>${tz}</option>`).join("")}
          </select>
        </label>
        <label>Working hours start<input id="settingsHoursStart" type="time" value="${settingsField(s.workingHoursStart || "09:00")}" /></label>
        <label>Working hours end<input id="settingsHoursEnd" type="time" value="${settingsField(s.workingHoursEnd || "18:00")}" /></label>
      </div>
      <strong>Working days</strong>
      <div class="settings-day-picker">
        ${days.map((day) => `<label class="day-chip"><input type="checkbox" data-working-day="${day}" ${(s.workingDays || []).includes(day) ? "checked" : ""} />${day}</label>`).join("")}
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="company" data-company-save>Save company settings</button>
      </div>
    </div>
  `;
}
function saveCompanySettings() {
  const workingDays = $$("[data-working-day]").filter((el) => el.checked).map((el) => el.dataset.workingDay);
  return saveSettingsCategory("company", {
    companyName: $("#settingsCompanyName").value.trim(),
    logoUrl: $("#settingsLogoUrl").value.trim(),
    website: $("#settingsWebsite").value.trim(),
    supportEmail: $("#settingsSupportEmail").value.trim(),
    phone: $("#settingsCompanyPhone").value.trim(),
    address: $("#settingsAddress").value.trim(),
    timezone: $("#settingsTimezone").value,
    workingHoursStart: $("#settingsHoursStart").value,
    workingHoursEnd: $("#settingsHoursEnd").value,
    workingDays,
    brandColor: $("#settingsBrandColor").value
  }, "Company settings saved");
}

// ── User & Role Management ──────────────────────────────────────────
function renderUsersSettings() {
  const users = state.usersData || [];
  const roles = [
    ["Admin", "User management, reports, audit monitoring, compliance oversight"],
    ["Recruiter", "Candidate search, job creation, pipeline movement, outreach"],
    ["Account Manager", "Job management, pipeline review, reports"],
    ["Hiring Manager", "View assigned jobs, review candidates, interview feedback"],
    ["Viewer", "Read-only access for reports and pipeline visibility"]
  ];
  const roleKeyMap = {
    "Admin": "admin", "Recruiter": "recruiter", "Account Manager": "account_manager",
    "Hiring Manager": "hiring_manager", "Viewer": "viewer"
  };
  const matrixRows = [
    ["Dashboard", "Full", "Full", "View", "View", "Limited"],
    ["Inbox", "Full", "Full", "View", "No access", "View"],
    ["Candidates", "Full", "Full", "View", "View", "View"],
    ["Jobs", "Full", "Full", "Approve", "View", "View"],
    ["Pipeline", "Full", "Full", "Review", "Full", "View"],
    ["Outreach", "Full", "Full", "View", "No access", "No access"],
    ["Reports", "Full", "Full", "Full", "View", "View"],
    ["Compliance", "Full", "Manage", "View", "No access", "No access"],
    ["Users", "Full", "No access", "No access", "No access", "No access"]
  ];
  return `
    ${settingsSectionHeader("User & Role Management", "Invite teammates and manage their roles and access.")}
    <div class="settings-card">
      <h3>Invite a user</h3>
      <div class="settings-grid">
        <label>Name<input id="settingsInviteName" placeholder="Full name" /></label>
        <label>Email<input id="settingsInviteEmail" type="email" placeholder="name@company.com" /></label>
        <label>Role
          <select id="settingsInviteRole">
            <option value="recruiter">Recruiter</option>
            <option value="account_manager">Account Manager</option>
            <option value="hiring_manager">Hiring Manager</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
      </div>
      <div class="settings-actions">
        <button class="primary" data-invite-user>Send invite</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Team members</h3>
      <div class="settings-table-scroll">
        <table class="settings-mini-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${users.length ? users.map((u) => `
            <tr>
              <td>${escapeHtml(u.name || "—")}</td>
              <td>${escapeHtml(u.email || "—")}</td>
              <td>
                <select data-user-role="${u.id}" ${u.id === state.currentUser?.id ? "disabled title='You cannot change your own role'" : ""}>
                  ${["admin", "recruiter", "account_manager", "hiring_manager", "viewer"].map((role) => `<option value="${role}" ${u.role === role ? "selected" : ""}>${escapeHtml(ROLE_LABELS[role] || role)}</option>`).join("")}
                </select>
              </td>
              <td><span class="badge ${u.active === false ? "danger-badge" : "done"}">${u.active === false ? "Deactivated" : "Active"}</span></td>
              <td>
                ${u.id === state.currentUser?.id ? "" : `<button class="icon-action ${u.active === false ? "" : "danger"}" data-toggle-user-active="${u.id}" title="${u.active === false ? "Reactivate" : "Deactivate"}">${u.active === false ? "↺" : icon("trash")}</button>`}
              </td>
            </tr>
          `).join("") : `<tr><td colspan="5" class="empty-inline">No users loaded yet.</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
    <div class="settings-card">
      <h3>Role overview</h3>
      <div class="role-grid">
        ${roles.map(([role, detail]) => {
          const dbKey = roleKeyMap[role] || role.toLowerCase();
          const count = users.filter((u) => u.role === dbKey).length;
          return `<div><strong>${escapeHtml(role)}</strong><span>${escapeHtml(detail)}</span><em>${count} account${count === 1 ? "" : "s"}</em></div>`;
        }).join("")}
      </div>
    </div>
    <div class="settings-card">
      <h3>Role access matrix</h3>
      <div class="settings-table-scroll">
        <table class="settings-mini-table">
        <thead><tr><th>Module</th><th>Admin</th><th>Recruiter</th><th>Account Manager</th><th>Hiring Manager</th><th>Viewer</th></tr></thead>
        <tbody>${matrixRows.map((row) => `<tr>${row.map((cell, i) => `<td${i === 0 ? "" : ` class="cell-${cell.toLowerCase().replace(/ /g, "_")}"`}>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
      </div>
    </div>
  `;
}

async function inviteUser() {
  const name = $("#settingsInviteName").value.trim();
  const email = $("#settingsInviteEmail").value.trim();
  const role = $("#settingsInviteRole").value;
  if (!name || !email) return toast("Enter a name and email to invite", "error");
  const btn = document.querySelector("[data-invite-user]");
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Sending...";
  try {
    await api("/api/users", { method: "POST", body: JSON.stringify({ name, email, role }) });
    toast(`Invite sent to ${email}`, "success");
    $("#settingsInviteName").value = "";
    $("#settingsInviteEmail").value = "";
    await loadUsersData();
  } catch (error) {
    toast(error.message || "Failed to send invite", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function changeUserRole(userId, role) {
  try {
    await api(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    toast("Role updated", "success");
    try {
      await api("/api/user-notifications", {
        method: "POST",
        body: JSON.stringify({
          userId, category: "account",
          title: "Your role was changed",
          message: `An admin changed your role to ${ROLE_LABELS[role] || role}.`,
          targetView: "settings:profile"
        })
      });
    } catch {
      // Non-critical -- the role change itself already succeeded above.
    }
    await loadUsersData();
  } catch (error) {
    toast(error.message || "Failed to update role", "error");
    await loadUsersData();
  }
}

function confirmToggleUserActive(userId) {
  const user = (state.usersData || []).find((u) => u.id === userId);
  if (!user) return;
  const deactivating = user.active !== false;
  confirmDestructive(
    deactivating ? "Deactivate user" : "Reactivate user",
    deactivating
      ? `${user.name} will lose access immediately. They can be reactivated later.`
      : `${user.name} will regain access to the workspace.`,
    deactivating ? "Deactivate" : "Reactivate",
    async () => {
      try {
        await api(`/api/users/${userId}`, { method: "PATCH", body: JSON.stringify({ active: !deactivating }) });
        toast(deactivating ? "User deactivated" : "User reactivated", "success");
        $("#previewModal").hidden = true;
        await loadUsersData();
      } catch (error) {
        toast(error.message || "Failed to update user", "error");
      }
    }
  );
}

// ── Resume Parsing ───────────────────────────────────────────────────
function renderResumeParsingSettings() {
  const s = state.settingsData.settings.resumeParsing || {};
  const allFormats = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"];
  return `
    ${settingsSectionHeader("Resume Parsing Settings", "Control which files are accepted and how they're processed.")}
    <div class="settings-card">
      <strong>Supported formats</strong>
      <div class="settings-day-picker">
        ${allFormats.map((fmt) => `<label class="day-chip"><input type="checkbox" data-resume-format="${fmt}" ${(s.supportedFormats || []).includes(fmt) ? "checked" : ""} />${fmt}</label>`).join("")}
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsOcrEnabled" ${s.ocrEnabled ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>OCR for scanned/image resumes</strong></div>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsAutoParseUpload" ${s.autoParseOnUpload ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Auto-parse on upload</strong></div>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsDuplicateDetection" ${s.duplicateDetection ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Duplicate detection</strong></div>
      </div>
      <label>Duplicate match threshold (%)
        <input id="settingsDuplicateThreshold" type="number" min="50" max="100" value="${settingsField(s.duplicateMatchThreshold)}" />
      </label>
      <div class="settings-actions">
        <button class="primary" data-save-category="resumeParsing" data-resume-parsing-save>Save resume parsing settings</button>
      </div>
    </div>
  `;
}
function saveResumeParsingSettings() {
  const supportedFormats = $$("[data-resume-format]").filter((el) => el.checked).map((el) => el.dataset.resumeFormat);
  return saveSettingsCategory("resumeParsing", {
    supportedFormats,
    ocrEnabled: $("#settingsOcrEnabled").checked,
    autoParseOnUpload: $("#settingsAutoParseUpload").checked,
    duplicateDetection: $("#settingsDuplicateDetection").checked,
    duplicateMatchThreshold: Number($("#settingsDuplicateThreshold").value) || 90
  }, "Resume parsing settings saved");
}

// ── AI Settings ──────────────────────────────────────────────────────
function renderAiSettings() {
  const s = state.settingsData.settings.ai || {};
  const weights = s.matchWeights || {};
  const weightRow = (key, label) => `
    <label class="weight-slider">
      <span>${escapeHtml(label)} <strong>${settingsField(weights[key])}</strong></span>
      <input type="range" min="0" max="100" data-weight="${key}" value="${settingsField(weights[key])}" />
    </label>
  `;
  return `
    ${settingsSectionHeader("AI Settings", "Matching provider, scoring weights, and AI-assisted features.")}
    <div class="settings-card">
      <div class="settings-grid">
        <label>Provider<input value="${s.apiKeyConfigured ? "Cohere (external)" : "Local ATS ranking engine"}" disabled /></label>
        <label>API key<input value="${s.apiKeyConfigured ? "•••••••• (set via COHERE_API_KEY)" : "Not configured"}" disabled /></label>
      </div>
      <p class="muted small">The AI provider key is configured on the server via an environment variable for security and can't be edited here.</p>
    </div>
    <div class="settings-card">
      <h3>Match scoring weights</h3>
      <p class="muted">Relative importance of each factor. Weights are automatically rebalanced to total 100%.</p>
      ${weightRow("skills", "Skills")}
      ${weightRow("experience", "Experience")}
      ${weightRow("education", "Education")}
      ${weightRow("certifications", "Certifications")}
      ${weightRow("projects", "Projects")}
      ${weightRow("semantic", "Semantic similarity")}
      <div class="settings-actions">
        <button class="primary" data-save-category="ai" data-ai-weights-save>Save scoring weights</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>AI features</h3>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsAiOutreach" ${s.aiOutreachDrafting ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>AI outreach drafting</strong></div>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsAiSummaries" ${s.aiResumeSummaries ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>AI resume summaries</strong></div>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsAiExplanations" ${s.aiMatchExplanations ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>AI match explanations</strong></div>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="ai" data-ai-features-save>Save AI features</button>
      </div>
    </div>
  `;
}
function saveAiWeights() {
  const matchWeights = {};
  $$("[data-weight]").forEach((el) => { matchWeights[el.dataset.weight] = Number(el.value); });
  return saveSettingsCategory("ai", { matchWeights }, "Scoring weights saved — new match scores will reflect this immediately");
}
function saveAiFeatures() {
  return saveSettingsCategory("ai", {
    aiOutreachDrafting: $("#settingsAiOutreach").checked,
    aiResumeSummaries: $("#settingsAiSummaries").checked,
    aiMatchExplanations: $("#settingsAiExplanations").checked
  }, "AI feature settings saved");
}

// ── Email & SMTP ─────────────────────────────────────────────────────
function renderEmailSettings() {
  const s = state.settingsData.settings.email || {};
  return `
    ${settingsSectionHeader("Email & Notifications", "SMTP delivery and reusable email templates.")}
    <div class="settings-card">
      <div class="settings-grid">
        <label>SMTP host<input id="settingsSmtpHost" value="${settingsField(s.smtpHost)}" placeholder="smtp.example.com" /></label>
        <label>SMTP port<input id="settingsSmtpPort" type="number" value="${settingsField(s.smtpPort || 587)}" /></label>
        <label>SMTP username<input id="settingsSmtpUser" value="${settingsField(s.smtpUser)}" /></label>
        <label>From name<input id="settingsFromName" value="${settingsField(s.fromName)}" /></label>
        <label>From email<input id="settingsFromEmail" type="email" value="${settingsField(s.fromEmail)}" /></label>
      </div>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsSmtpSecure" ${s.smtpSecure ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Use TLS/SSL</strong></div>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="email" data-email-save>Save email settings</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Email templates</h3>
      <div class="settings-table-scroll">
        <table class="settings-mini-table">
        <thead><tr><th>Name</th><th>Subject</th><th>Body</th><th></th></tr></thead>
        <tbody>
          ${(s.templates || []).map((t) => `
            <tr>
              <td><input type="text" value="${settingsField(t.name)}" data-email-template-field="${t.id}:name" /></td>
              <td><input type="text" value="${settingsField(t.subject)}" data-email-template-field="${t.id}:subject" /></td>
              <td><textarea rows="2" data-email-template-field="${t.id}:body">${settingsField(t.body)}</textarea></td>
              <td><button class="icon-action danger" data-remove-email-template="${t.id}" title="Delete">${icon("trash")}</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      </div>
      <button type="button" class="secondary compact-button" data-add-email-template>+ Add template</button>
      <div class="settings-actions">
        <button class="primary" data-save-category="email" data-email-templates-save>Save templates</button>
      </div>
    </div>
  `;
}
function saveEmailSettings() {
  return saveSettingsCategory("email", {
    smtpHost: $("#settingsSmtpHost").value.trim(),
    smtpPort: Number($("#settingsSmtpPort").value) || 587,
    smtpUser: $("#settingsSmtpUser").value.trim(),
    smtpSecure: $("#settingsSmtpSecure").checked,
    fromName: $("#settingsFromName").value.trim(),
    fromEmail: $("#settingsFromEmail").value.trim()
  }, "Email settings saved");
}
function saveEmailTemplates() {
  const templates = getWorkingCategoryList("email", "templates");
  return saveSettingsCategory("email", { templates }, "Templates saved").then(() => clearWorkingCategoryLists("email"));
}

// ── Compliance ───────────────────────────────────────────────────────
function renderComplianceSettings() {
  const s = state.settingsData.settings.compliance || {};
  return `
    ${settingsSectionHeader("Compliance Settings", "Document requirements and verification rules.")}
    <div class="settings-card">
      <div class="settings-list-editor">
        <strong>Document types</strong>
        <div class="settings-chip-list" data-list-key="documentTypes">
          ${(s.documentTypes || []).map((item, idx) => `<span class="settings-chip">${escapeHtml(item)}<button type="button" data-remove-chip="documentTypes:${idx}" aria-label="Remove">×</button></span>`).join("")}
        </div>
        <div class="settings-chip-add">
          <input type="text" placeholder="Add document type..." data-chip-input="documentTypes" />
          <button type="button" class="secondary compact-button" data-add-chip="documentTypes">Add</button>
        </div>
      </div>
      <label>Expiry reminder (days before expiry)
        <input id="settingsExpiryReminderDays" type="number" min="1" value="${settingsField(s.expiryReminderDays)}" />
      </label>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsRequireVerification" ${s.requireVerificationBeforeOffer ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Require verification before offer</strong></div>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="compliance" data-compliance-save>Save compliance settings</button>
      </div>
    </div>
  `;
}
function saveComplianceSettings() {
  return saveSettingsCategory("compliance", {
    documentTypes: getWorkingCategoryList("compliance", "documentTypes"),
    expiryReminderDays: Number($("#settingsExpiryReminderDays").value) || 30,
    requireVerificationBeforeOffer: $("#settingsRequireVerification").checked
  }, "Compliance settings saved").then(() => clearWorkingCategoryLists("compliance"));
}

// ── Integrations ─────────────────────────────────────────────────────
function renderIntegrationsSettings() {
  const s = state.settingsData.settings.integrations || {};
  const providers = [
    ["googleCalendar", "Google Calendar"], ["outlook", "Outlook"], ["teams", "Microsoft Teams"],
    ["zoom", "Zoom"], ["linkedin", "LinkedIn"]
  ];
  return `
    ${settingsSectionHeader("Integrations", "Connect external calendars, meetings, and networks.")}
    <div class="settings-card integration-grid">
      ${providers.map(([key, label]) => `
        <div class="integration-tile">
          <strong>${escapeHtml(label)}</strong>
          <span class="badge ${s[key]?.connected ? "done" : ""}">${s[key]?.connected ? "Connected" : "Not connected"}</span>
          <button class="secondary compact-button" data-toggle-integration="${key}">${s[key]?.connected ? "Disconnect" : "Connect"}</button>
        </div>
      `).join("")}
    </div>
    <div class="settings-card">
      <h3>Webhooks</h3>
      <div class="settings-table-scroll">
        <table class="settings-mini-table">
        <thead><tr><th>URL</th><th>Event</th><th></th></tr></thead>
        <tbody>
          ${(s.webhooks || []).map((w, idx) => `
            <tr>
              <td>${escapeHtml(w.url)}</td>
              <td>${escapeHtml(w.event)}</td>
              <td><button class="icon-action danger" data-remove-webhook="${idx}" title="Delete">${icon("trash")}</button></td>
            </tr>
          `).join("") || `<tr><td colspan="3" class="empty-inline">No webhooks configured.</td></tr>`}
        </tbody>
      </table>
      </div>
      <div class="settings-grid">
        <input type="text" id="settingsWebhookUrl" placeholder="https://your-app.com/webhook" />
        <select id="settingsWebhookEvent">
          <option value="candidate.created">candidate.created</option>
          <option value="application.stage_changed">application.stage_changed</option>
          <option value="offer.sent">offer.sent</option>
        </select>
        <button class="secondary compact-button" data-add-webhook>Add webhook</button>
      </div>
    </div>
  `;
}
function toggleIntegration(key) {
  const s = state.settingsData.settings.integrations || {};
  const connected = !s[key]?.connected;
  return saveSettingsCategory("integrations", { [key]: { connected } }, connected ? "Connected" : "Disconnected");
}
function addWebhook() {
  const url = $("#settingsWebhookUrl").value.trim();
  const event = $("#settingsWebhookEvent").value;
  if (!url) return toast("Enter a webhook URL", "error");
  const webhooks = [...(state.settingsData.settings.integrations?.webhooks || []), { url, event }];
  return saveSettingsCategory("integrations", { webhooks }, "Webhook added");
}
function removeWebhook(idx) {
  const webhooks = (state.settingsData.settings.integrations?.webhooks || []).filter((_, i) => i !== Number(idx));
  return saveSettingsCategory("integrations", { webhooks }, "Webhook removed");
}

// ── Security ─────────────────────────────────────────────────────────
function renderSecuritySettings() {
  const s = state.settingsData.settings.security || {};
  const auditLog = state.settingsAuditLog || [];
  return `
    ${settingsSectionHeader("Security Settings", "Password policy, sessions, and the change history for every settings update.")}
    <div class="settings-card">
      <h3>Password policy</h3>
      <div class="settings-grid">
        <label>Minimum length<input id="settingsPwMinLength" type="number" min="6" max="32" value="${settingsField(s.passwordMinLength)}" /></label>
        <label>Session timeout (minutes)<input id="settingsSessionTimeout" type="number" min="5" value="${settingsField(s.sessionTimeoutMinutes)}" /></label>
      </div>
      <div class="settings-toggle-row"><label class="switch"><input type="checkbox" id="settingsPwNumber" ${s.passwordRequireNumber ? "checked" : ""} /><span class="slider"></span></label><div><strong>Require a number</strong></div></div>
      <div class="settings-toggle-row"><label class="switch"><input type="checkbox" id="settingsPwSymbol" ${s.passwordRequireSymbol ? "checked" : ""} /><span class="slider"></span></label><div><strong>Require a symbol</strong></div></div>
      <div class="settings-toggle-row"><label class="switch"><input type="checkbox" id="settingsPwUppercase" ${s.passwordRequireUppercase ? "checked" : ""} /><span class="slider"></span></label><div><strong>Require an uppercase letter</strong></div></div>
      <div class="settings-toggle-row"><label class="switch"><input type="checkbox" id="settingsMfaRequired" ${s.mfaRequiredForAdmins ? "checked" : ""} /><span class="slider"></span></label><div><strong>Require MFA for admins</strong></div></div>
      <div class="settings-list-editor">
        <strong>IP allowlist</strong>
        <div class="settings-chip-list" data-list-key="ipAllowlist">
          ${(s.ipAllowlist || []).map((item, idx) => `<span class="settings-chip">${escapeHtml(item)}<button type="button" data-remove-chip="ipAllowlist:${idx}" aria-label="Remove">×</button></span>`).join("")}
        </div>
        <div class="settings-chip-add">
          <input type="text" placeholder="Add IP or CIDR range..." data-chip-input="ipAllowlist" />
          <button type="button" class="secondary compact-button" data-add-chip="ipAllowlist">Add</button>
        </div>
        <p class="muted small">Leave empty to allow sign-in from any IP address.</p>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="security" data-security-save>Save security settings</button>
      </div>
    </div>
    <div class="settings-card">
      <h3>Settings audit log</h3>
      <button type="button" class="secondary compact-button" data-load-audit-log>Load recent changes</button>
      <div class="settings-table-scroll">
        <table class="settings-mini-table">
        <thead><tr><th>When</th><th>Who</th><th>Category</th><th>Fields</th></tr></thead>
        <tbody>
          ${auditLog.length ? auditLog.map((entry) => `
            <tr>
              <td>${formatDate(entry.at)}</td>
              <td>${escapeHtml(entry.actorName)}</td>
              <td>${escapeHtml(SETTINGS_CATEGORY_META.find((c) => c.id === entry.category)?.label || entry.category)}</td>
              <td>${escapeHtml(entry.field)}</td>
            </tr>
          `).join("") : `<tr><td colspan="4" class="empty-inline">Click "Load recent changes" to view the audit trail.</td></tr>`}
        </tbody>
      </table>
      </div>
    </div>
  `;
}
function saveSecuritySettings() {
  return saveSettingsCategory("security", {
    passwordMinLength: Number($("#settingsPwMinLength").value) || 8,
    sessionTimeoutMinutes: Number($("#settingsSessionTimeout").value) || 60,
    passwordRequireNumber: $("#settingsPwNumber").checked,
    passwordRequireSymbol: $("#settingsPwSymbol").checked,
    passwordRequireUppercase: $("#settingsPwUppercase").checked,
    mfaRequiredForAdmins: $("#settingsMfaRequired").checked,
    ipAllowlist: getWorkingCategoryList("security", "ipAllowlist")
  }, "Security settings saved").then(() => clearWorkingCategoryLists("security"));
}
async function loadAuditLog() {
  try {
    const result = await api("/api/settings-audit");
    state.settingsAuditLog = result.entries || [];
    renderSettings();
  } catch (error) {
    toast(error.message || "Failed to load audit log", "error");
  }
}

// ── File & Storage ───────────────────────────────────────────────────
function renderStorageSettings() {
  const s = state.settingsData.settings.storage || {};
  const allFormats = [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"];
  return `
    ${settingsSectionHeader("File & Storage Settings", "Upload limits and accepted file types.")}
    <div class="settings-card">
      <div class="settings-grid">
        <label>Max single upload (MB)<input id="settingsMaxUploadMb" type="number" min="1" value="${settingsField(s.maxUploadSizeMb)}" /></label>
        <label>Max bulk upload (MB)<input id="settingsMaxBulkUploadMb" type="number" min="1" value="${settingsField(s.maxBulkUploadSizeMb)}" /></label>
        <label>Storage provider
          <select id="settingsStorageProvider">
            <option value="local" ${s.storageProvider === "local" ? "selected" : ""}>Local disk</option>
            <option value="s3" ${s.storageProvider === "s3" ? "selected" : ""}>Amazon S3</option>
            <option value="gcs" ${s.storageProvider === "gcs" ? "selected" : ""}>Google Cloud Storage</option>
          </select>
        </label>
      </div>
      <strong>Allowed file types</strong>
      <div class="settings-day-picker">
        ${allFormats.map((fmt) => `<label class="day-chip"><input type="checkbox" data-storage-format="${fmt}" ${(s.allowedFileTypes || []).includes(fmt) ? "checked" : ""} />${fmt}</label>`).join("")}
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="storage" data-storage-save>Save storage settings</button>
      </div>
    </div>
  `;
}
function saveStorageSettings() {
  const allowedFileTypes = $$("[data-storage-format]").filter((el) => el.checked).map((el) => el.dataset.storageFormat);
  return saveSettingsCategory("storage", {
    maxUploadSizeMb: Number($("#settingsMaxUploadMb").value) || 10,
    maxBulkUploadSizeMb: Number($("#settingsMaxBulkUploadMb").value) || 1024,
    storageProvider: $("#settingsStorageProvider").value,
    allowedFileTypes
  }, "Storage settings saved");
}

// ── Reports & Export ─────────────────────────────────────────────────
function renderReportsSettingsPage() {
  const s = state.settingsData.settings.reports || {};
  return `
    ${settingsSectionHeader("Reports & Export Settings", "Defaults for exports and scheduled reports.")}
    <div class="settings-card">
      <label>Default export format
        <select id="settingsExportFormat">
          <option value="csv" ${s.defaultExportFormat === "csv" ? "selected" : ""}>CSV</option>
          <option value="xlsx" ${s.defaultExportFormat === "xlsx" ? "selected" : ""}>XLSX</option>
          <option value="pdf" ${s.defaultExportFormat === "pdf" ? "selected" : ""}>PDF</option>
        </select>
      </label>
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsIncludeArchived" ${s.includeArchivedInExports ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Include archived records in exports</strong></div>
      </div>
      <div class="settings-actions">
        <button class="primary" data-save-category="reports" data-reports-save>Save export settings</button>
      </div>
    </div>
  `;
}
function saveReportsSettingsPage() {
  return saveSettingsCategory("reports", {
    defaultExportFormat: $("#settingsExportFormat").value,
    includeArchivedInExports: $("#settingsIncludeArchived").checked
  }, "Export settings saved");
}

// ── System ───────────────────────────────────────────────────────────
function renderSystemSettings() {
  const s = state.settingsData.settings.system || {};
  const status = state.systemStatus || {};
  return `
    ${settingsSectionHeader("System Settings", "Environment status and maintenance controls.")}
    <div class="settings-card">
      <div class="settings-grid">
        <label>AI provider<input value="${status.status === "configured" ? "External AI key configured" : "Using local ATS ranking engine"}" disabled /></label>
        <label>Candidates on file<input value="${state.data.candidates?.length || 0}" disabled /></label>
        <label>Open jobs<input value="${(state.data.jobs || []).filter((j) => j.status === "open").length}" disabled /></label>
        <label>Last backup<input value="${settingsField(s.lastBackupAt) || "Never"}" disabled /></label>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-toggle-row">
        <label class="switch"><input type="checkbox" id="settingsMaintenanceMode" ${s.maintenanceMode ? "checked" : ""} /><span class="slider"></span></label>
        <div><strong>Maintenance mode</strong><span class="muted">Show a maintenance banner to non-admin users.</span></div>
      </div>
      <label>Maintenance message<textarea id="settingsMaintenanceMessage" rows="2">${settingsField(s.maintenanceMessage)}</textarea></label>
      <div class="settings-actions">
        <button class="primary" data-save-category="system" data-system-save>Save system settings</button>
        <button class="secondary" data-backup-now>Run backup now</button>
      </div>
    </div>
  `;
}
function saveSystemSettings() {
  return saveSettingsCategory("system", {
    maintenanceMode: $("#settingsMaintenanceMode").checked,
    maintenanceMessage: $("#settingsMaintenanceMessage").value.trim()
  }, "System settings saved");
}
function confirmBackupNow() {
  confirmDestructive(
    "Run backup now",
    "This will snapshot the current database to the server's backup location.",
    "Run backup",
    async () => {
      try {
        await saveSettingsCategory("system", { lastBackupAt: new Date().toISOString() }, "Backup completed");
        $("#previewModal").hidden = true;
      } catch (error) {
        toast(error.message || "Backup failed", "error");
      }
    }
  );
}

const SETTINGS_RENDERERS = {
  profile: renderProfileSettings,
  appearance: renderAppearanceSettings,
  notifications: renderNotificationSettings,
  recruitment: renderRecruitmentSettings,
  clients: renderClientSettings,
  company: renderCompanySettings,
  users: renderUsersSettings,
  resumeParsing: renderResumeParsingSettings,
  ai: renderAiSettings,
  email: renderEmailSettings,
  compliance: renderComplianceSettings,
  integrations: renderIntegrationsSettings,
  security: renderSecuritySettings,
  storage: renderStorageSettings,
  reports: renderReportsSettingsPage,
  system: renderSystemSettings
};

async function deleteCandidate(candidateId, { skipConfirm = false } = {}) {
  const candidate = state.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;
  if (!skipConfirm && !confirm(`Are you sure you want to delete ${candidate.name}? This also removes their job pipeline entries.`)) return;
  const result = await api(`/api/candidates/${candidateId}`, { method: "DELETE" });
  await applyServerState(result);
  $("#previewModal").hidden = true;
  toast(`${candidate.name} deleted`);
}

function confirmRemoveFromPipeline(appId) {
  const app = state.data.applications.find((item) => item.id === appId);
  if (!app) return;
  const candidate = state.data.candidates.find((item) => item.id === app.candidateId);
  const job = state.data.jobs.find((item) => item.id === app.jobId);
  const candidateName = candidate?.name || "this candidate";
  $("#candidatePreviewName").textContent = "Remove candidate";
  $("#candidatePreviewMeta").textContent = `${candidateName} · ${job?.title || "Job"}`;
  $("#candidatePreviewBody").innerHTML = `
    <div class="confirm-remove">
      <p>How do you want to remove <strong>${escapeHtml(candidateName)}</strong> from <strong>${escapeHtml(job?.title || "this job")}</strong>?</p>
      <div class="confirm-remove-actions">
        <button data-confirm-remove-pipeline="${app.id}" class="primary-mini">Remove from this pipeline only</button>
        <button data-confirm-delete-candidate="${candidate?.id || ""}" class="danger">Delete candidate completely</button>
        <button data-close-preview class="ghost-button">Cancel</button>
      </div>
      <p class="muted small">"Remove from pipeline" keeps ${escapeHtml(candidateName)} in Candidate Management and any other job pipelines. "Delete candidate completely" removes them everywhere, including all pipeline entries.</p>
    </div>
  `;
  $("#previewModal").hidden = false;
}

async function removeFromPipeline(appId) {
  const app = state.data.applications.find((item) => item.id === appId);
  const candidate = state.data.candidates.find((item) => item.id === app?.candidateId);
  const result = await api(`/api/applications/${appId}`, { method: "DELETE" });
  await applyServerState(result);
  $("#previewModal").hidden = true;
  toast(`${candidate?.name || "Candidate"} removed from pipeline`);
}

async function deleteJob(jobId) {
  const job = state.data.jobs.find((item) => item.id === jobId);
  if (!job) return;
  if (!confirm(`Delete ${job.title}? This also removes its pipeline entries.`)) return;
  const result = await api(`/api/jobs/${jobId}`, { method: "DELETE" });
  if (state.pipelineJobId === jobId) state.pipelineJobId = "";
  await applyServerState(result);
  toast(`${job.title} deleted`);
}

function selectedCandidateIds(singleId = "") {
  return singleId ? [singleId] : [...state.selectedCandidates];
}

async function bulkDeleteCandidates() {
  const ids = selectedCandidateIds();
  if (!ids.length) return toast("Select candidates first");
  const result = await api("/api/candidates/bulk-delete", {
    method: "POST",
    body: JSON.stringify({ candidateIds: ids })
  });
  state.selectedCandidates.clear();
  state.undoToken = result.token;
  await applyServerState(result);
  showUndo(`${result.deleted} candidate(s) deleted`);
}

function showUndo(message) {
  $("#undoText").textContent = message;
  $("#undoToast").hidden = false;
  setTimeout(() => {
    if (state.undoToken) {
      state.undoToken = "";
      $("#undoToast").hidden = true;
    }
  }, 3000);
}

async function undoDelete() {
  if (!state.undoToken) return;
  const result = await api("/api/candidates/undo-delete", {
    method: "POST",
    body: JSON.stringify({ token: state.undoToken })
  });
  state.undoToken = "";
  $("#undoToast").hidden = true;
  await applyServerState(result);
  toast(`${result.restored} candidate(s) restored`);
}

async function emailCandidates(candidateIds = selectedCandidateIds(), options = {}) {
  if (!candidateIds.length) return toast("Select candidates first");
  const jobId = options.jobId || state.pipelineJobId || $("#outreachJob")?.value || state.data.jobs.find((job) => job.status === "open")?.id;
  const btn = $("#sendOutreach");
  const origLabel = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = "Sending…"; }
  try {
    const result = await api("/api/outreach", {
      method: "POST",
      body: JSON.stringify({ candidateIds, jobId, subject: options.subject, message: options.message, type: options.type })
    });
    await applyServerState(result);
    const sent = (result.sent || []).filter((item) => item.status === "sent").length;
    const queued = (result.sent || []).filter((item) => item.status === "queued").length;
    const failed = (result.sent || []).length - sent - queued;
    const msg = sent > 0
      ? `✓ ${sent} email${sent > 1 ? "s" : ""} sent${queued ? ", " + queued + " queued" : ""}${failed ? ", " + failed + " failed" : ""}`
      : queued > 0
        ? `✓ ${queued} email${queued > 1 ? "s" : ""} queued for dispatch`
        : `${failed} failed — check candidate emails`;
    toast(msg, sent > 0 || queued > 0 ? "success" : "");
    renderOutreach();
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origLabel || "Send Selected"; }
  }
}

function switchView(view) {
  const moduleKey = NAV_MODULE_BY_VIEW[view];
  if (moduleKey && state.currentUser && !canView(moduleKey)) {
    toast("You don't have access to that section.");
    view = "dashboard";
  }
  // Remember where the user was on the view they're leaving, so coming back
  // to it later (e.g. after checking another tab) doesn't reset them to the top.
  if (state.view) state.scrollPositions[state.view] = window.scrollY;
  const isSameView = state.view === view;
  state.view = view;
  $$(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  const activeNav = $(`.nav[data-view="${view}"]`);
  $("#pageTitle").textContent = activeNav ? activeNav.textContent.replace(/^[A-Z]{2}/, "").trim() : view;
  renderAiStrip();
  if (!isSameView) {
    const savedTop = state.scrollPositions[view] || 0;
    window.scrollTo({ top: savedTop, behavior: savedTop ? "auto" : "smooth" });
  }
}

function openOutreachComposer(candidateIds = []) {
  candidateIds.forEach((id) => state.selectedCandidates.add(id));
  switchView("outreach");
  if (candidateIds.length === 1) {
    $("#outreachType").value = "individual";
    $("#outreachCandidate").value = candidateIds[0];
    $("#outreachCandidateSearch").value = "";
  } else {
    $("#outreachType").value = "bulk";
  }
  renderCandidates();
  renderOutreach();
  toast(candidateIds.length === 1 ? "Candidate ready in Outreach" : "Selected candidates ready in Outreach");
}

async function generateOutreachMessage() {
  const job = state.data.jobs.find((item) => item.id === $("#outreachJob")?.value) || state.data.jobs.find((item) => item.status === "open");
  const type = $("#outreachType")?.value || "individual";
  const individual = getOutreachIndividualCandidate();
  const ids = type === "individual" && individual ? [individual.id] : selectedCandidateIds();
  if (!ids.length) return toast(type === "individual" ? "Choose or type a candidate name first" : "Select candidates for bulk outreach first");
  $("#generateOutreach").disabled = true;
  $("#generateOutreach").textContent = "Generating...";
  try {
    const result = await api("/api/outreach-draft", {
      method: "POST",
      body: JSON.stringify({ candidateIds: ids, jobId: job?.id, type })
    });
    $("#outreachSubject").value = result.subject || "";
    $("#outreachMessage").value = result.message || "";
    toast(result.aiUsed ? "Cohere outreach draft generated" : "Outreach draft generated locally");
  } finally {
    $("#generateOutreach").disabled = false;
    $("#generateOutreach").textContent = "Generate AI Message";
  }
}

async function sendSelectedOutreach() {
  const type = $("#outreachType")?.value || "individual";
  const individual = getOutreachIndividualCandidate();
  const isBulk = type !== "individual";
  const ids = !isBulk && individual ? [individual.id] : selectedCandidateIds();
  if (!ids.length) {
    if (!isBulk) return toast("Choose or type a candidate name first");
    return toast("Select at least one candidate from the list below");
  }
  const subject = $("#outreachSubject")?.value.trim();
  if (!subject) return toast("Add an email subject before sending");
  await emailCandidates(ids, {
    jobId: $("#outreachJob")?.value,
    subject,
    message: $("#outreachMessage")?.value.trim(),
    type
  });
}

async function scheduleFollowup() {
  const individual = getOutreachIndividualCandidate();
  const ids = individual ? [individual.id] : selectedCandidateIds();
  if (!ids.length) return toast("Select at least one candidate to follow up with");
  const subject = $("#outreachSubject")?.value.trim();
  if (!subject) return toast("Add an email subject before scheduling");
  const afterDays = Number($("#followupAfterDays")?.value) || 3;
  const button = $("#scheduleFollowup");
  if (button) { button.disabled = true; button.textContent = "Scheduling..."; }
  try {
    const result = await api("/api/outreach/follow-ups", {
      method: "POST",
      body: JSON.stringify({
        candidateIds: ids,
        jobId: $("#outreachJob")?.value,
        subject,
        message: $("#outreachMessage")?.value.trim(),
        afterDays
      })
    });
    await applyServerState(result);
    toast(`Follow-up scheduled for ${ids.length} candidate(s) in ${afterDays} day(s)`);
  } catch (error) {
    toast(error.message || "Unable to schedule follow-up");
  } finally {
    if (button) { button.disabled = false; button.textContent = "Schedule Follow-up"; }
  }
}

async function cancelFollowup(followupId) {
  try {
    const result = await api(`/api/outreach/follow-ups/${followupId}/cancel`, { method: "POST", body: JSON.stringify({}) });
    await applyServerState(result);
    toast("Follow-up cancelled");
  } catch (error) {
    toast(error.message || "Unable to cancel follow-up");
  }
}

function resumeSectionsFromText(text) {
  const headingPattern = /(Education|Technical Skills|Programming Languages|Web Technologies|Problem Solving|Projects|Academic Projects|Internships|Trainings & Workshops|Achievements|Extra-curricular Activities|Certifications|Experience|Professional Experience|Summary|Objective|Contact|Hobbies)/gi;
  const normalized = String(text || "")
    .replace(/\s+/g, " ")
    .replace(headingPattern, "\n$1\n")
    .replace(/\s*•\s*/g, "\n• ")
    .replace(/\s+(\d+\.\s+)/g, "\n$1")
    .trim();

  const lines = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = { title: "Resume Details", lines: [] };

  for (const line of lines) {
    headingPattern.lastIndex = 0;
    const isHeading = headingPattern.test(line) && line.length <= 42;
    if (isHeading) {
      if (current.lines.length) sections.push(current);
      current = { title: line.replace(/\s+/g, " "), lines: [] };
      continue;
    }
    current.lines.push(line);
  }

  if (current.lines.length) sections.push(current);
  return sections;
}

function formatResumeText(text) {
  const sections = resumeSectionsFromText(text);
  if (!sections.length) {
    return `<div class="formatted-resume empty-text">No resume text available.</div>`;
  }

  return `
    <div class="formatted-resume">
      ${sections.map((section) => `
        <section>
          <h5>${escapeHtml(section.title)}</h5>
          ${section.lines.map((line) => {
            const cleaned = line.replace(/^•\s*/, "").trim();
            const isBullet = line.startsWith("•") || /^\d+\.\s+/.test(line);
            return isBullet ? `<div class="resume-bullet">${escapeHtml(cleaned)}</div>` : `<p>${escapeHtml(line)}</p>`;
          }).join("")}
        </section>
      `).join("")}
    </div>
  `;
}

async function showMatchBreakdown(candidateId) {
  const jobId = $("#matchBreakdownJobSelect")?.value;
  const panel = $("#matchBreakdownPanel");
  if (!jobId) return toast("Choose a job to compare against");
  panel.innerHTML = `<p class="muted">Calculating full breakdown...</p>`;
  try {
    const result = await api(`/api/candidates/${candidateId}/match/${jobId}`);
    const b = result.breakdown;
    panel.innerHTML = `
      <div class="match-breakdown">
        <div class="match-breakdown-head">
          <strong class="${matchScoreClass(b.overallMatch)}">${b.overallMatch}%</strong>
          <span>${escapeHtml(b.recommendation)}</span>
        </div>
        <div class="match-breakdown-components">
          ${Object.entries(b.componentScores).map(([key, value]) => `
            <div><span>${escapeHtml(key.replace(/([A-Z])/g, " $1"))}</span><strong>${value}%</strong></div>
          `).join("")}
        </div>
        <div class="match-breakdown-lists">
          <div><h4>Matched Skills</h4><p>${b.matchedSkills.length ? escapeHtml(b.matchedSkills.join(", ")) : "None"}</p></div>
          <div><h4>Missing Required Skills</h4><p>${b.missingSkills.length ? escapeHtml(b.missingSkills.join(", ")) : "None"}</p></div>
          <div><h4>Strengths</h4><ul>${b.strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join("") || "<li>None identified</li>"}</ul></div>
          <div><h4>Weaknesses</h4><ul>${b.weaknesses.map((w) => `<li>${escapeHtml(w)}</li>`).join("") || "<li>None identified</li>"}</ul></div>
        </div>
        ${b.semantic.status !== "ok" ? `<p class="muted">Semantic similarity: unavailable (${escapeHtml(b.semantic.reason || "not configured")}) — its weight was redistributed across the other components.</p>` : `<p class="muted">Semantic similarity: ${b.semantic.score}%</p>`}
      </div>
    `;
  } catch (error) {
    panel.innerHTML = `<p class="muted">${escapeHtml(error.message || "Unable to load match breakdown")}</p>`;
  }
}

function previewCandidate(candidateId) {
  const candidate = state.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;
  const skills = (candidate.skills || []).join(", ") || "No parsed skills";
  const apps = state.data.applications.filter((app) => app.candidateId === candidate.id);
  const outreach = state.data.outreachLog.filter((item) => item.candidateId === candidate.id);
  const jobOptions = state.data.jobs.filter((job) => job.status === "open").map((job) => `<option value="${job.id}">${escapeHtml(job.title)}</option>`).join("");
  const bestMatch = candidateBestMatch(candidate);
  $("#candidatePreviewName").textContent = candidate.name;
  $("#candidatePreviewMeta").textContent = `${candidate.currentRole || "Candidate"} · ${candidate.email || "No email"} · ${candidate.experienceYears || 0} years`;
  $("#candidatePreviewBody").innerHTML = `
    <div class="candidate-profile">
      <section>
        <h3>Overview</h3>
        <div class="profile-grid">
          <div><span>Role</span><strong>${escapeHtml(candidate.currentRole || "Candidate")}</strong></div>
          <div><span>Location</span><strong>${escapeHtml(candidate.location || "Not listed")}</strong></div>
          <div><span>Experience</span><strong>${candidate.experienceYears || 0} yrs</strong></div>
          <div><span>Best Match</span><strong class="${matchScoreClass(bestMatch.score)}">${bestMatch.score || 0}%</strong></div>
          <div><span>Status</span><strong>${inferOpenToWork(candidate, null) ? "Open To Work" : "Not listed"}</strong></div>
          <div><span>Hot List</span><strong>${isHotCandidate(candidate) ? "Hot" : "No"}</strong></div>
          <div><span>Contact</span><strong>${escapeHtml(candidate.email || "No email")}</strong></div>
          <div><span>Current Company</span><strong>${escapeHtml(candidate.currentCompany || "Not listed")}</strong></div>
          <div><span>Employment</span><strong>${escapeHtml(candidate.employmentStatus || "Not listed")}</strong></div>
          <div><span>Notice Period</span><strong>${escapeHtml(candidate.noticePeriod || "Not listed")}</strong></div>
          <div><span>Availability</span><strong>${escapeHtml(candidate.availability || "Not listed")}</strong></div>
        </div>
      </section>
      <section class="ats-analysis-tab">
        <h3>ATS Analysis</h3>
        ${candidate.atsReport
          ? renderAtsReportHtml(candidate, candidate.atsReport)
          : `<div class="empty-state"><strong>Not analyzed yet</strong><span>This resume hasn't been through ATS analysis.</span><button type="button" class="secondary compact-button" data-refresh-ats-report="${candidate.id}">Analyze now</button></div>`}
      </section>
      <section>
        <h3>Resume</h3>
        ${formatResumeText(candidate.resumeText)}
      </section>
      <section>
        <h3>Skills</h3>
        <div class="skills">${(candidate.skills || []).map((skill) => `<span class="skill">${escapeHtml(skill)}</span>`).join("") || `<span class="muted">No parsed skills</span>`}</div>
      </section>
      <section>
        <h3>Experience</h3>
        <p>${escapeHtml(candidate.aiSummary || `${candidate.name} has ${candidate.experienceYears || 0} years of parsed experience.`)}</p>
      </section>
      <section>
        <h3>Job Matches</h3>
        ${apps.length ? apps.map((app) => `<div class="profile-row"><strong>${escapeHtml(app.job?.title || "Job")}</strong><span class="${matchScoreClass(app.matchScore)}">${app.matchScore}%</span><em>${escapeHtml(stageLabels[normalizeStageName(app.stage)] || normalizeStageName(app.stage))}</em></div>`).join("") : `<p class="muted">No linked jobs.</p>`}
        <div class="candidate-job-actions">
          <select id="candidateJobSelect">${jobOptions}</select>
          <button data-add-preview-candidate="${candidate.id}" class="primary">Add to Job</button>
          <button data-email-candidate="${candidate.id}">Email Candidate</button>
        </div>
        <div class="match-breakdown-trigger">
          <select id="matchBreakdownJobSelect">${jobOptions}</select>
          <button data-view-match-breakdown="${candidate.id}" class="secondary">View Match Breakdown</button>
        </div>
        <div id="matchBreakdownPanel"></div>
      </section>
      <section>
        <h3>Pipeline History</h3>
        ${apps.length ? apps.map((app) => `<div class="profile-row"><strong>${escapeHtml(app.job?.title || "Job")}</strong><span>${escapeHtml(stageLabels[normalizeStageName(app.stage)] || normalizeStageName(app.stage))}${app.decision ? ` · ${escapeHtml(app.decision)}` : ""}</span><em>${formatDate(app.updatedAt || app.appliedAt)}</em></div>`).join("") : `<p class="muted">No pipeline history.</p>`}
      </section>
      <section>
        <h3>Candidate Profile</h3>
        ${canEdit("candidates") ? `
          <div class="candidate-edit-form">
            <label>Status
              <select id="candidateEditStatus">
                ${["active", "on_hold", "placed", "do_not_contact"].map((value) => `<option value="${value}" ${candidate.status === value ? "selected" : ""}>${value.replace(/_/g, " ")}</option>`).join("")}
              </select>
            </label>
            <label><input id="candidateEditOpenToWork" type="checkbox" ${inferOpenToWork(candidate, null) ? "checked" : ""} /> Available / ready to apply</label>
            <label><input id="candidateEditHotList" type="checkbox" ${isHotCandidate(candidate) ? "checked" : ""} /> Mark as Hot List</label>
            <label>Current Company
              <input id="candidateEditCurrentCompany" type="text" value="${escapeHtml(candidate.currentCompany || "")}" placeholder="e.g. Infosys, ASJ client, Freelance" />
            </label>
            <label>Employment Status
              <select id="candidateEditEmploymentStatus">
                ${["", "Available", "Currently working", "Serving notice", "Contract", "Not looking"].map((value) => `<option value="${value}" ${String(candidate.employmentStatus || "") === value ? "selected" : ""}>${value || "Not listed"}</option>`).join("")}
              </select>
            </label>
            <label>Notice Period
              <input id="candidateEditNoticePeriod" type="text" value="${escapeHtml(candidate.noticePeriod || "")}" placeholder="e.g. Immediate, 15 days, 30 days" />
            </label>
            <label>Availability Notes
              <input id="candidateEditAvailability" type="text" value="${escapeHtml(candidate.availability || "")}" placeholder="e.g. Ready to apply, remote only, after offer" />
            </label>
            <label>Tags <span class="muted">(comma separated)</span>
              <input id="candidateEditTags" type="text" value="${escapeHtml((candidate.tags || []).join(", "))}" placeholder="e.g. Referral, Senior, Remote OK" />
            </label>
            <label>Notes
              <textarea id="candidateEditNotes" rows="3" placeholder="Internal notes about this candidate...">${escapeHtml(candidate.notes || "")}</textarea>
            </label>
            <button data-save-candidate="${candidate.id}" class="primary-mini">Save Changes</button>
          </div>
        ` : `
          <div class="profile-grid">
            <div><span>Status</span><strong>${escapeHtml((candidate.status || "active").replace(/_/g, " "))}</strong></div>
            <div><span>Hot List</span><strong>${isHotCandidate(candidate) ? "Hot" : "No"}</strong></div>
            <div><span>Current Company</span><strong>${escapeHtml(candidate.currentCompany || "Not listed")}</strong></div>
            <div><span>Employment</span><strong>${escapeHtml(candidate.employmentStatus || "Not listed")}</strong></div>
            <div><span>Tags</span><strong>${escapeHtml((candidate.tags || []).join(", ") || "None")}</strong></div>
          </div>
          <p>${escapeHtml(candidate.notes || "No notes yet.")}</p>
        `}
      </section>
      <section>
        <h3>Pipeline Notes</h3>
        <p>${escapeHtml(apps.map((app) => app.notes).filter(Boolean).join(" ") || "No pipeline notes yet.")}</p>
      </section>
      <section>
        <h3>Communication History</h3>
        ${outreach.length ? outreach.slice(-5).reverse().map((item) => `<div class="profile-row"><strong>${escapeHtml(item.subject || "Outreach")}</strong><span>${escapeHtml(item.status || "queued")}</span><em>${formatDate(item.createdAt)}</em></div>`).join("") : `<p class="muted">No communication history.</p>`}
      </section>
    </div>
  `;
  $("#previewModal").hidden = false;
}

function previewInboxResume(resumeId) {
  const resume = state.data.websiteResumes.find((item) => item.id === resumeId);
  if (!resume) return;
  const isEmbeddable = /\.(pdf|png|jpe?g|webp|gif)$/i.test(resume.fileName || resume.resumeUrl || "");
  $("#candidatePreviewName").textContent = inferResumeName(resume);
  $("#candidatePreviewMeta").textContent = `${resume.fileName || "Resume"} · ${resume.fileType || "Text"} · ${resume.parser || "manual"} · ${resume.extractionQuality || "pending"}`;
  const canTryEmbed = resume.resumeUrl?.startsWith("/uploads/") && isEmbeddable;
  $("#candidatePreviewBody").innerHTML = `
    <div class="resume-preview-grid">
      <div class="file-frame" id="resumeFileFrame">
        ${canTryEmbed
          ? `<div class="empty-state"><strong>Loading preview…</strong></div>`
          : `<div class="empty-state"><strong>Preview shown as parsed text</strong><span>This file type cannot be rendered by the browser, but the resume content is shown on this page.</span></div>`}
      </div>
      <div class="parsed-frame">
        <div class="review-head">
          <h3>Parsed Text</h3>
          <div class="table-actions">
            ${resume.resumeUrl?.startsWith("/uploads/") ? `<a class="button-link" href="${apiUrl(resume.resumeUrl)}" target="_blank" rel="noreferrer">${isEmbeddable ? "Open File" : "Download File"}</a>` : ""}
            <button data-save-resume="${resume.id}" class="primary-mini">Save Update</button>
            <button data-delete-resume="${resume.id}" class="danger">Delete</button>
          </div>
        </div>
        <textarea id="resumeReviewText" class="review-textarea" rows="18">${escapeHtml(resume.resumeText || "")}</textarea>
      </div>
    </div>
  `;
  $("#previewModal").hidden = false;
  if (canTryEmbed) loadResumeFilePreview(resume);
}

// Fetch protected uploads with the same auth headers as API calls, then render a local
// blob URL. This keeps previews working even when cross-site cookies are unavailable.
async function loadResumeFilePreview(resume) {
  const frame = $("#resumeFileFrame");
  if (!frame) return;
  try {
    const response = await fetch(apiUrl(resume.resumeUrl), {
      method: "GET",
      credentials: API_BASE_URL ? "include" : "same-origin",
      headers: authHeaders()
    });
    if (!response.ok) throw new Error(`File not available (HTTP ${response.status})`);
    if (!$("#resumeFileFrame") || $("#candidatePreviewMeta").textContent.indexOf(resume.fileName || "Resume") === -1) return; // modal moved on
    const blob = await response.blob();
    if (frame.dataset.previewUrl) URL.revokeObjectURL(frame.dataset.previewUrl);
    const blobUrl = URL.createObjectURL(blob);
    frame.dataset.previewUrl = blobUrl;
    frame.innerHTML = `<iframe src="${blobUrl}" title="Resume file preview"></iframe>`;
  } catch (error) {
    if (!$("#resumeFileFrame")) return;
    frame.innerHTML = `
      <div class="empty-state">
        <strong>Preview unavailable</strong>
        <span>The stored file couldn't be reached (${escapeHtml(error.message)}). The parsed text on the right is still accurate -- try "Open File" to check the original, or re-upload if it's missing.</span>
      </div>
    `;
  }
}

async function saveResumeReview(resumeId) {
  const resume = state.data.websiteResumes.find((item) => item.id === resumeId);
  if (!resume) return;
  const result = await api(`/api/website-resumes/${resumeId}`, {
    method: "PATCH",
    body: JSON.stringify({ resumeText: $("#resumeReviewText")?.value || resume.resumeText, fileName: resume.fileName })
  });
  await applyServerState(result);
  toast("Resume updated");
  previewInboxResume(resumeId);
}

async function saveCandidateEdits(candidateId) {
  const candidate = state.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;
  const button = $(`[data-save-candidate="${candidateId}"]`);
  const body = {
    status: $("#candidateEditStatus")?.value,
    openToWork: Boolean($("#candidateEditOpenToWork")?.checked),
    hotList: Boolean($("#candidateEditHotList")?.checked),
    currentCompany: $("#candidateEditCurrentCompany")?.value || "",
    employmentStatus: $("#candidateEditEmploymentStatus")?.value || "",
    noticePeriod: $("#candidateEditNoticePeriod")?.value || "",
    availability: $("#candidateEditAvailability")?.value || "",
    tags: $("#candidateEditTags")?.value || "",
    notes: $("#candidateEditNotes")?.value || ""
  };
  if (button) { button.disabled = true; button.textContent = "Saving..."; }
  try {
    const result = await api(`/api/candidates/${candidateId}`, { method: "PATCH", body: JSON.stringify(body) });
    await applyServerState(result);
    toast("Candidate updated");
    previewCandidate(candidateId);
  } catch (error) {
    toast(error.message || "Unable to update candidate");
  } finally {
    if (button) { button.disabled = false; button.textContent = "Save Changes"; }
  }
}

async function deleteResume(resumeId) {
  const resume = state.data.websiteResumes.find((item) => item.id === resumeId);
  if (!resume) return;
  if (!confirm(`Delete ${resume.fileName || "this resume"} from Resume Inbox?`)) return;
  const result = await api(`/api/website-resumes/${resumeId}`, { method: "DELETE" });
  state.selectedResumes.delete(resumeId);
  await applyServerState(result);
  $("#previewModal").hidden = true;
  toast("Resume deleted");
}

async function bulkResumeAction(action) {
  const ids = [...state.selectedResumes].filter((id) => state.data.websiteResumes.some((resume) => resume.id === id));
  if (!ids.length) return toast("Select resumes first");
  if (action === "delete") {
    if (!confirm(`Delete ${ids.length} selected resume(s)?`)) return;
    let latest = null;
    for (const id of ids) {
      latest = await api(`/api/website-resumes/${id}`, { method: "DELETE" });
    }
    state.selectedResumes.clear();
    if (latest) await applyServerState(latest);
    toast(`${ids.length} resume(s) deleted`);
    return;
  }
  if (action === "parse") {
    await syncResumes();
    return;
  }
  if (action === "review") {
    previewInboxResume(ids[0]);
    toast(`Opened first of ${ids.length} selected resume(s) for review`);
  }
}

async function askAi() {
  const out = $("#aiOutput");
  const prompt = $("#aiPrompt").value.trim();
  if (!prompt) return;
  $("#aiPrompt").value = "";
  out.className = "ai-output loading";
  state.aiChats.push({ prompt, text: "Thinking...", createdAt: new Date().toISOString(), pending: true });
  renderAiChatHistory();
  out.innerHTML = `<div class="empty-state"><strong>AI is thinking...</strong><span>Reading candidates, jobs, matches, and pipeline data.</span></div>`;
  $("#askAi").disabled = true;
  $("#askAi").textContent = "Sending...";
  try {
    const result = await api("/api/ai-insight", {
      method: "POST",
      body: JSON.stringify({ prompt, page: state.view })
    });
    renderAiOutput(result.text);
    state.aiChats = [...state.aiChats.filter((chat) => !chat.pending), { prompt, text: result.text, createdAt: new Date().toISOString() }];
    if (result.chats && state.data) state.data.aiChats = result.chats;
    renderAiChatHistory();
    renderPreviousAiChats();
    state.recommendations = result.recommendations || state.recommendations;
    renderAiStrip();
  } catch (error) {
    renderAiOutput(error.message, true);
    state.aiChats = [...state.aiChats.filter((chat) => !chat.pending), { prompt, text: error.message, createdAt: new Date().toISOString() }];
    renderAiChatHistory();
  } finally {
    $("#askAi").disabled = false;
    $("#askAi").textContent = "Send";
  }
}

function linkCandidateNames(text) {
  let html = escapeHtml(text);
  for (const candidate of state.data?.candidates || []) {
    const name = escapeHtml(candidate.name);
    const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    html = html.replace(pattern, `<button class="inline-candidate" data-preview="${candidate.id}">${name}</button>`);
  }
  return html;
}

function renderAiChatHistory() {
  const box = $("#aiChatHistory");
  if (!box) return;
  const chats = state.aiChats;
  box.innerHTML = chats.length ? chats.map((chat) => `
    <div class="chat-turn">
      <div class="chat-user">${escapeHtml(chat.prompt || "Prompt")}</div>
      <div class="chat-bot">${linkCandidateNames(chat.text || "")}</div>
    </div>
  `).join("") : `
    <div class="chat-welcome">
      <strong>Ask AI about your hiring pipeline.</strong>
      <span>Ask for shortlists, job coverage, candidate risks, interview plans, or outreach drafts.</span>
    </div>
  `;
  box.scrollTop = box.scrollHeight;
}

function renderPreviousAiChats() {
  const box = $("#previousAiChats");
  if (!box) return;
  const chats = (state.data?.aiChats || []).slice(-8).reverse();
  box.innerHTML = chats.length ? chats.map((chat) => `
    <button class="previous-chat-item ${state.openedPreviousChatId === chat.id ? "active" : ""}" data-open-ai-chat="${chat.id}">
      <span class="previous-chat-copy">
        <strong>${escapeHtml(chat.prompt || "ATS chat")}</strong>
        <em>${new Date(chat.createdAt).toLocaleString()}</em>
      </span>
      <span class="previous-chat-delete" data-delete-ai-chat="${chat.id}" aria-label="Delete chat">Delete</span>
    </button>
  `).join("") : `<div class="empty-inline">No previous chats yet.</div>`;
}

function openPreviousAiChat(chatId) {
  const chat = (state.data?.aiChats || []).find((item) => item.id === chatId);
  if (!chat) return;
  state.openedPreviousChatId = chat.id;
  state.aiChats = [chat];
  $("#aiPrompt").value = "";
  renderAiChatHistory();
  renderPreviousAiChats();
}

async function deleteAiChat(chatId) {
  const result = await api(`/api/ai-chats/${chatId}`, { method: "DELETE" });
  state.data = result.data || state.data;
  if (result.chats && state.data) state.data.aiChats = result.chats;
  if (state.openedPreviousChatId === chatId) {
    state.openedPreviousChatId = "";
    state.aiChats = [];
    renderAiChatHistory();
  }
  renderPreviousAiChats();
  toast("Chat deleted");
}

function startNewAiChat() {
  state.aiChats = [];
  state.openedPreviousChatId = "";
  $("#aiPrompt").value = "";
  $("#aiOutput").className = "ai-output empty";
  $("#aiOutput").innerHTML = `
    <div class="empty-state">
      <strong>New chat ready</strong>
      <span>Previous ATS Intelligence chats are still saved above for reference.</span>
    </div>
  `;
  $("#aiChatHistory").innerHTML = `
    <div class="chat-welcome">
      <strong>AI is ready</strong>
      <span>Ask about candidates, jobs, matches, interviews, or outreach.</span>
    </div>
  `;
  $("#aiPrompt").focus();
  renderPreviousAiChats();
}

async function askPageAi() {
  $("#pageAiBtn").disabled = true;
  $("#pageAiBtn").textContent = "Generating...";

  try {
    const result = await api("/api/ai-insight", {
      method: "POST",
      body: JSON.stringify({
        page: state.view,
        prompt: `Act as AI and give the recruiter the most useful next action for the ${state.view} page. Include top candidates, eligible candidates, job matches, or market-fit gaps when relevant.`
      })
    });
    state.recommendations = result.recommendations || state.recommendations;
    $("#aiStripText").textContent = result.text.split("\n").map(normalizeAiLine).filter(Boolean).slice(0, 2).join(" ");
  } catch (error) {
    toast(error.message);
    renderAiStrip();
  } finally {
    $("#pageAiBtn").disabled = false;
    $("#pageAiBtn").textContent = "Generate Page Brief";
  }
}

$$(".nav").forEach((button) => {
  button.addEventListener("click", () => {
    switchView(button.dataset.view);
  });
});

const SEARCHABLE_VIEWS = new Set(["inbox", "candidates", "jobs", "clients", "compliance", "pipeline"]);

$("#search").addEventListener("input", (event) => {
  state.query = event.target.value;
  if (isBooleanLike(state.query)) {
    state.booleanQuery = state.query.trim();
    evaluateCandidateBoolean(state.booleanQuery);
  } else if (state.booleanQuery === state.query.trim()) {
    state.booleanQuery = "";
    state.booleanResults = new Map();
  }
  renderCandidates();
  renderJobs();
  renderClients();
  renderCompliance();
  if (state.view === "inbox") {
    state.resumeSearch = state.query;
    renderInbox();
  }
});
$("#search").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  // If we're already on a page with its own searchable list (Resume Management,
  // Candidates, Jobs, Clients, Compliance, Pipeline), stay put and just make sure
  // it reflects the typed query -- jumping to Candidates from here was the bug.
  if (SEARCHABLE_VIEWS.has(state.view)) {
    if (state.view === "inbox") {
      state.resumeSearch = state.query;
      renderInbox();
    } else {
      render();
    }
    return;
  }
  const candidateMatches = filtered(state.data.candidates, ["name", "currentRole", "email", "location", "aiSummary", (candidate) => candidate.skills || []]);
  const jobMatches = filtered(state.data.jobs, ["title", "location", "description", "department", (job) => job.skills || []]);
  const nextView = candidateMatches.length >= jobMatches.length ? "candidates" : "jobs";
  state.view = nextView;
  $$(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === nextView));
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === nextView));
  $("#pageTitle").textContent = nextView === "jobs" ? "Jobs" : "Candidates";
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast(`${candidateMatches.length} candidate(s), ${jobMatches.length} job(s) found`);
});

$("#syncBtn").addEventListener("click", syncResumes);
$("#syncBtn2").addEventListener("click", syncResumes);
$("#reparseBtn").addEventListener("click", reparseResumes);
$("#uploadResume").addEventListener("click", uploadResume);
$("#importFolder").addEventListener("click", importFolder);
$("#extractJob").addEventListener("click", extractJob);
$("#createJob").addEventListener("click", createJob);
$("#cancelJobEdit").addEventListener("click", resetJobForm);
$("#refreshSystem").addEventListener("click", refreshSystemStatus);
$("#pipelineJob").addEventListener("change", (event) => {
  state.pipelineJobId = event.target.value;
  renderPipeline();
});
$("#pipelineSearch").addEventListener("input", (event) => {
  state.pipelineSearch = event.target.value;
  renderPipeline();
});
$("#generateOutreach").addEventListener("click", generateOutreachMessage);
$("#sendOutreach").addEventListener("click", sendSelectedOutreach);
$("#scheduleFollowup")?.addEventListener("click", scheduleFollowup);
$("#outreachType").addEventListener("change", renderOutreach);
$("#outreachCandidate").addEventListener("change", renderOutreach);
$("#outreachCandidateSearch").addEventListener("input", renderOutreach);
$("#undoDelete").addEventListener("click", undoDelete);
$("#notificationBell")?.addEventListener("click", (event) => {
  event.stopPropagation();
  const panel = $("#notificationPanel");
  const opening = panel.hidden;
  if (opening) {
    closeProfileMenu();
    closeSettingsOverlay();
  }
  panel.hidden = !opening;
  if (opening) loadNotifications();
});
$("#markAllReadBtn")?.addEventListener("click", markAllNotificationsRead);
$("#activitySearch")?.addEventListener("input", (event) => {
  state.activitySearch = event.target.value;
  renderActivityLog();
});
$("#activityResetFilter")?.addEventListener("click", () => {
  state.activitySearch = "";
  if ($("#activitySearch")) $("#activitySearch").value = "";
  renderActivityLog();
});
document.addEventListener("click", (event) => {
  const item = event.target.closest("[data-notification-item]");
  if (item) {
    markNotificationRead(item.dataset.notificationItem);
    const target = item.dataset.notificationTarget;
    if (target?.startsWith("settings:")) {
      $("#notificationPanel").hidden = true;
      openSettingsOverlay(target.split(":")[1]);
    } else if (target) {
      $("#notificationPanel").hidden = true;
      switchView(target);
    }
  }
  const panel = $("#notificationPanel");
  if (panel && !panel.hidden && !event.target.closest(".notification-wrap")) panel.hidden = true;
});
$("#candidateSearch")?.addEventListener("input", (event) => {
  const value = event.target.value;
  state.candidateFilters.search = value;
  if (isBooleanLike(value)) {
    state.booleanQuery = value.trim();
    evaluateCandidateBoolean(state.booleanQuery);
  } else {
    state.booleanQuery = "";
    state.booleanResults = new Map();
  }
  state.candidatePage = 1;
  renderCandidates();
});
["#candidateJobFilter", "#candidateStageFilter", "#candidateExperienceFilter", "#candidateOpenFilter", "#candidateHotFilter"].forEach((selector) => {
  $(selector)?.addEventListener("change", (event) => {
    const keys = {
      "#candidateJobFilter": "job",
      "#candidateStageFilter": "stage",
      "#candidateExperienceFilter": "experience",
      "#candidateOpenFilter": "openToWork",
      "#candidateHotFilter": "hotList"
    };
    state.candidateFilters[keys[selector]] = event.target.value;
    state.candidatePage = 1;
    renderCandidates();
  });
});
$("#candidateBulkAction")?.addEventListener("change", (event) => runCandidateBulkAction(event.target.value));
$("#exportCandidates")?.addEventListener("click", exportCandidates);
$("#complianceSearch")?.addEventListener("input", (event) => {
  state.complianceFilters.search = event.target.value;
  renderCompliance();
});
["#complianceStatusFilter", "#complianceVisaFilter", "#complianceClearanceFilter", "#complianceExpiryFilter"].forEach((selector) => {
  $(selector)?.addEventListener("change", (event) => {
    const keys = {
      "#complianceStatusFilter": "status",
      "#complianceVisaFilter": "visa",
      "#complianceClearanceFilter": "clearance",
      "#complianceExpiryFilter": "expiry"
    };
    state.complianceFilters[keys[selector]] = event.target.value;
    renderCompliance();
  });
});
$("#complianceResetFilters")?.addEventListener("click", () => {
  state.complianceFilters = { search: "", status: "", visa: "", clearance: "", expiry: "" };
  ["#complianceSearch", "#complianceStatusFilter", "#complianceVisaFilter", "#complianceClearanceFilter", "#complianceExpiryFilter"].forEach((selector) => {
    if ($(selector)) $(selector).value = "";
  });
  renderCompliance();
});
$("#downloadReportPdf")?.addEventListener("click", downloadReportPdf);
$("#exportCandidatesReport")?.addEventListener("click", exportCandidates);
$("#exportJobsReport")?.addEventListener("click", exportJobsReport);
$("#exportComplianceReport")?.addEventListener("click", exportComplianceReport);
$("#exportRecruiterReport")?.addEventListener("click", exportRecruiterReport);
$("#askAi").addEventListener("click", askAi);
$("#aiPrompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askAi();
  }
});
$("#newAiChat").addEventListener("click", startNewAiChat);
$("#pageAiBtn").addEventListener("click", askPageAi);
document.addEventListener("click", (event) => {
  const clear = event.target.closest("[data-clear-input]");
  if (clear) {
    clear.dataset.clearInput.split(",").forEach((rawId) => {
      const input = document.getElementById(rawId.trim());
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    return;
  }
  const jump = event.target.closest("[data-jump-view]");
  if (jump) {
    switchView(jump.dataset.jumpView);
  }
  const promptButton = event.target.closest("[data-prompt]");
  if (promptButton) {
    $("#aiPrompt").value = promptButton.dataset.prompt;
    if (promptButton.classList.contains("insight-tile")) askAi();
  }
  const deleteChat = event.target.closest("[data-delete-ai-chat]");
  if (deleteChat) {
    event.stopPropagation();
    deleteAiChat(deleteChat.dataset.deleteAiChat);
    return;
  }
  const previousChat = event.target.closest("[data-open-ai-chat]");
  if (previousChat) openPreviousAiChat(previousChat.dataset.openAiChat);
  const sortButton = event.target.closest("[data-candidate-sort]");
  if (sortButton) {
    const key = sortButton.dataset.candidateSort;
    state.candidateSort = {
      key,
      direction: state.candidateSort.key === key && state.candidateSort.direction === "desc" ? "asc" : "desc"
    };
    state.candidatePage = 1;
    renderCandidates();
  }
  const pageButton = event.target.closest("[data-candidate-page]");
  if (pageButton && !pageButton.disabled) {
    state.candidatePage = Math.max(1, Number(pageButton.dataset.candidatePage || 1));
    renderCandidates();
  }
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-move]");
  if (button) moveApplication(button.dataset.move, button.dataset.stage);
  const decision = event.target.closest("[data-decision]");
  if (decision) decideApplication(decision.dataset.decision, decision.dataset.result);
});
document.addEventListener("click", (event) => {
  const openJob = event.target.closest("[data-open-job]");
  if (openJob) {
    state.pipelineJobId = openJob.dataset.openJob;
    switchView("pipeline");
    renderPipeline();
  }
  const addToJob = event.target.closest("[data-add-to-job]");
  if (addToJob) addCandidateToJob(addToJob.dataset.addToJob, addToJob.dataset.job, addToJob.dataset.stage || "Applied");
  const addPreview = event.target.closest("[data-add-preview-candidate]");
  if (addPreview) addCandidateToJob(addPreview.dataset.addPreviewCandidate, $("#candidateJobSelect")?.value || state.pipelineJobId, "Applied");
  const assignCandidate = event.target.closest("[data-assign-candidate]");
  if (assignCandidate) assignCandidateQuick(assignCandidate.dataset.assignCandidate);
  const emailButton = event.target.closest("[data-email-candidate]");
  if (emailButton) openOutreachComposer([emailButton.dataset.emailCandidate]);
  const deleteButton = event.target.closest("[data-delete-candidate]");
  if (deleteButton) deleteCandidate(deleteButton.dataset.deleteCandidate);
  const confirmRemoveButton = event.target.closest("[data-confirm-remove]");
  if (confirmRemoveButton) confirmRemoveFromPipeline(confirmRemoveButton.dataset.confirmRemove);
  const removePipelineButton = event.target.closest("[data-confirm-remove-pipeline]");
  if (removePipelineButton) removeFromPipeline(removePipelineButton.dataset.confirmRemovePipeline);
  const deleteCandidateFromDialog = event.target.closest("[data-confirm-delete-candidate]");
  if (deleteCandidateFromDialog && deleteCandidateFromDialog.dataset.confirmDeleteCandidate) {
    deleteCandidate(deleteCandidateFromDialog.dataset.confirmDeleteCandidate, { skipConfirm: true });
  }
  const closePreviewButton = event.target.closest("[data-close-preview]");
  if (closePreviewButton) $("#previewModal").hidden = true;
  const deleteResumeButton = event.target.closest("[data-delete-resume]");
  if (deleteResumeButton) deleteResume(deleteResumeButton.dataset.deleteResume);
  const saveResumeButton = event.target.closest("[data-save-resume]");
  if (saveResumeButton) saveResumeReview(saveResumeButton.dataset.saveResume);
  const saveCandidateButton = event.target.closest("[data-save-candidate]");
  if (saveCandidateButton) saveCandidateEdits(saveCandidateButton.dataset.saveCandidate);
  const deleteJobButton = event.target.closest("[data-delete-job]");
  if (deleteJobButton) deleteJob(deleteJobButton.dataset.deleteJob);
  const previewJobButton = event.target.closest("[data-preview-job]");
  if (previewJobButton) previewJob(previewJobButton.dataset.previewJob);
  const duplicateJobButton = event.target.closest("[data-duplicate-job]");
  if (duplicateJobButton) duplicateJob(duplicateJobButton.dataset.duplicateJob);
  const closeJobButton = event.target.closest("[data-close-job]");
  if (closeJobButton) closeJob(closeJobButton.dataset.closeJob);
  const previewButton = event.target.closest("[data-preview]");
  if (previewButton) previewCandidate(previewButton.dataset.preview);
  const inboxPreviewButton = event.target.closest("[data-resume-preview]");
  if (inboxPreviewButton) previewInboxResume(inboxPreviewButton.dataset.resumePreview);
  const bulkResumeButton = event.target.closest("[data-bulk-resume-action]");
  if (bulkResumeButton) bulkResumeAction(bulkResumeButton.dataset.bulkResumeAction);
  const editJobButton = event.target.closest("[data-edit-job]");
  if (editJobButton) {
    $("#previewModal").hidden = true;
    editJob(editJobButton.dataset.editJob);
  }
  const manageComplianceButton = event.target.closest("[data-manage-compliance]");
  if (manageComplianceButton) openComplianceManager(manageComplianceButton.dataset.manageCompliance);
  const verifyDocButton = event.target.closest("[data-verify-doc]");
  if (verifyDocButton) updateComplianceDocument(verifyDocButton.dataset.verifyDoc, { status: "verified" }, verifyDocButton.dataset.candidate);
  const flagDocButton = event.target.closest("[data-flag-doc]");
  if (flagDocButton) updateComplianceDocument(flagDocButton.dataset.flagDoc, { status: "review_required" }, flagDocButton.dataset.candidate);
  const deleteDocButton = event.target.closest("[data-delete-doc]");
  if (deleteDocButton) deleteComplianceDocument(deleteDocButton.dataset.deleteDoc, deleteDocButton.dataset.candidate);
  const cancelFollowupButton = event.target.closest("[data-cancel-followup]");
  if (cancelFollowupButton) cancelFollowup(cancelFollowupButton.dataset.cancelFollowup);
  const matchBreakdownButton = event.target.closest("[data-view-match-breakdown]");
  if (matchBreakdownButton) showMatchBreakdown(matchBreakdownButton.dataset.viewMatchBreakdown);
});
document.addEventListener("input", (event) => {
  const resumeSearchInput = event.target.closest("#resumeSearchInput");
  if (!resumeSearchInput) return;
  state.resumeSearch = resumeSearchInput.value;
  renderInbox();
  // Re-focus and restore cursor position since renderInbox() replaces the input element.
  const refreshedInput = $("#resumeSearchInput");
  if (refreshedInput) {
    refreshedInput.focus();
    const cursor = refreshedInput.value.length;
    refreshedInput.setSelectionRange(cursor, cursor);
  }
});

document.addEventListener("change", (event) => {
  const availableToggle = event.target.closest("#candidateEditOpenToWork");
  if (availableToggle && availableToggle.checked) {
    const hotToggle = $("#candidateEditHotList");
    if (hotToggle) hotToggle.checked = true;
  }

  const resumeSelectAll = event.target.closest("#resumeTableSelectAll");
  if (resumeSelectAll) {
    state.data.websiteResumes.forEach((resume) => {
      if (resumeSelectAll.checked) state.selectedResumes.add(resume.id);
      else state.selectedResumes.delete(resume.id);
    });
    renderInbox();
    return;
  }
  const resumeCheckbox = event.target.closest("[data-select-resume]");
  if (resumeCheckbox) {
    if (resumeCheckbox.checked) state.selectedResumes.add(resumeCheckbox.dataset.selectResume);
    else state.selectedResumes.delete(resumeCheckbox.dataset.selectResume);
    renderInbox();
    return;
  }
  const tableSelectAll = event.target.closest("#candidateTableSelectAll");
  if (tableSelectAll) {
    const candidates = applyCandidateFilters(state.data.candidates);
    candidates.forEach((candidate) => {
      if (tableSelectAll.checked) state.selectedCandidates.add(candidate.id);
      else state.selectedCandidates.delete(candidate.id);
    });
    renderCandidates();
    return;
  }
  const pageSizePicker = event.target.closest("#candidatePageSize");
  if (pageSizePicker) {
    const value = pageSizePicker.value;
    state.candidatePageSize = value === "all" ? "all" : Number(value);
    state.candidatePage = 1;
    renderCandidates();
    return;
  }
  const checkbox = event.target.closest("[data-select-candidate]");
  if (!checkbox) return;
  if (checkbox.checked) state.selectedCandidates.add(checkbox.dataset.selectCandidate);
  else state.selectedCandidates.delete(checkbox.dataset.selectCandidate);
  renderCandidates();
});

// Outreach bulk candidate list — checkbox toggles
document.addEventListener("change", (event) => {
  const outreachCb = event.target.closest("[data-outreach-candidate]");
  if (!outreachCb) return;
  const id = outreachCb.dataset.outreachCandidate;
  if (outreachCb.checked) state.selectedCandidates.add(id);
  else state.selectedCandidates.delete(id);
  // Update the item's selected class without full re-render to avoid scroll jump
  const label = outreachCb.closest(".outreach-candidate-item");
  if (label) label.classList.toggle("selected", outreachCb.checked);
  const all = state.data.candidates;
  const selectedCount = [...state.selectedCandidates].filter(id2 => all.find(c => c.id === id2)).length;
  if ($("#outreachBulkCount")) $("#outreachBulkCount").textContent = selectedCount + " selected";
  const names = [...state.selectedCandidates].map(sid => all.find(c => c.id === sid)?.name).filter(Boolean);
  if ($("#outreachRecipientsBulk")) {
    $("#outreachRecipientsBulk").textContent = names.length
      ? `${names.length} recipient(s): ${names.slice(0, 4).join(", ")}${names.length > 4 ? " ..." : ""}`
      : "Select candidates below or from the Candidates tab.";
  }
});

// Outreach — Select All / Clear All buttons
document.addEventListener("click", (event) => {
  if (event.target.closest("#outreachSelectAll")) {
    state.data.candidates.forEach(c => state.selectedCandidates.add(c.id));
    renderOutreach();
    return;
  }
  if (event.target.closest("#outreachClearAll")) {
    state.data.candidates.forEach(c => state.selectedCandidates.delete(c.id));
    renderOutreach();
    return;
  }
});

document.addEventListener("dragstart", (event) => {
  const app = event.target.closest("[data-drag-app]");
  const candidate = event.target.closest("[data-drag-candidate]");
  if (app) event.dataTransfer.setData("application/json", JSON.stringify({ appId: app.dataset.dragApp }));
  if (candidate) event.dataTransfer.setData("application/json", JSON.stringify({ candidateId: candidate.dataset.dragCandidate }));
});
document.addEventListener("dragover", (event) => {
  if (event.target.closest("[data-drop-stage]")) event.preventDefault();
});
document.addEventListener("drop", (event) => {
  const col = event.target.closest("[data-drop-stage]");
  if (!col) return;
  event.preventDefault();
  const payload = JSON.parse(event.dataTransfer.getData("application/json") || "{}");
  if (payload.appId) moveApplication(payload.appId, col.dataset.dropStage);
  if (payload.candidateId) addCandidateToJob(payload.candidateId, state.pipelineJobId, col.dataset.dropStage);
});

document.addEventListener("click", (event) => {
  const atsReportBtn = event.target.closest("[data-ats-report]");
  if (atsReportBtn) { openAtsReport(atsReportBtn.dataset.atsReport); return; }
  const refreshAtsBtn = event.target.closest("[data-refresh-ats-report]");
  if (refreshAtsBtn) { refreshAtsReport(refreshAtsBtn.dataset.refreshAtsReport); return; }
  if (event.target.closest("#exportAtsReports")) { exportAtsReports(); return; }
  if (event.target.closest("#analyzeAllResumes")) { analyzeAllUnanalyzedResumes(); return; }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("#atsScoreFilter")) { state.atsScoreFilter = event.target.value; renderInbox(); return; }
  if (event.target.matches("#atsSortBy")) { state.atsSortBy = event.target.value; renderInbox(); return; }
  if (event.target.matches("#atsMissingKeywordsFilter")) { state.atsMissingKeywordsFilter = event.target.checked; renderInbox(); return; }
  if (event.target.matches("#atsQualityFilter")) { state.atsQualityFilter = event.target.value; renderInbox(); return; }
});

document.addEventListener("click", (event) => {
  const statusChip = event.target.closest("[data-resume-status-filter]");
  if (statusChip) {
    const key = statusChip.dataset.resumeStatusFilter;
    state.resumeStatusFilter = state.resumeStatusFilter === key ? "" : key;
    renderInbox();
    return;
  }
  if (event.target.closest("[data-clear-resume-status-filter]")) {
    state.resumeStatusFilter = "";
    renderInbox();
    return;
  }
  const dashboardHealthCard = event.target.closest("[data-dashboard-health-filter]");
  if (dashboardHealthCard) {
    state.resumeStatusFilter = dashboardHealthCard.dataset.dashboardHealthFilter;
    switchView("inbox");
    renderInbox();
    return;
  }
});

// ── Settings module event wiring ────────────────────────────────────
document.addEventListener("click", (event) => {
  const navItem = event.target.closest("[data-settings-category]");
  if (navItem) {
    state.activeSettingsCategory = navItem.dataset.settingsCategory;
    clearWorkingCategoryLists(state.activeSettingsCategory);
    renderSettings();
    return;
  }
  if (event.target.closest("[data-profile-save]")) { saveProfileSettings(); return; }
  if (event.target.closest("[data-change-password]")) { changePassword(); return; }
  if (event.target.closest("[data-appearance-save]")) { saveAppearancePreferences(); return; }
  const themeBtn = event.target.closest("[data-appearance-theme]");
  if (themeBtn) { setAppearanceTheme(themeBtn.dataset.appearanceTheme); return; }
  if (event.target.closest("[data-notifications-save]")) { saveNotificationSettings(); return; }
  if (event.target.closest("[data-recruitment-save]")) { saveRecruitmentSettings(); return; }
  if (event.target.closest("[data-clients-save]")) { saveClientSettings(); return; }
  if (event.target.closest("[data-company-save]")) { saveCompanySettings(); return; }
  if (event.target.closest("[data-resume-parsing-save]")) { saveResumeParsingSettings(); return; }
  if (event.target.closest("[data-ai-weights-save]")) { saveAiWeights(); return; }
  if (event.target.closest("[data-ai-features-save]")) { saveAiFeatures(); return; }
  if (event.target.closest("[data-email-save]")) { saveEmailSettings(); return; }
  if (event.target.closest("[data-email-templates-save]")) { saveEmailTemplates(); return; }
  if (event.target.closest("[data-compliance-save]")) { saveComplianceSettings(); return; }
  if (event.target.closest("[data-security-save]")) { saveSecuritySettings(); return; }
  if (event.target.closest("[data-storage-save]")) { saveStorageSettings(); return; }
  if (event.target.closest("[data-reports-save]")) { saveReportsSettingsPage(); return; }
  if (event.target.closest("[data-system-save]")) { saveSystemSettings(); return; }
  if (event.target.closest("[data-backup-now]")) { confirmBackupNow(); return; }
  if (event.target.closest("[data-load-audit-log]")) { loadAuditLog(); return; }
  if (event.target.closest("[data-invite-user]")) { inviteUser(); return; }

  const toggleUserActive = event.target.closest("[data-toggle-user-active]");
  if (toggleUserActive) { confirmToggleUserActive(toggleUserActive.dataset.toggleUserActive); return; }

  const toggleIntegrationBtn = event.target.closest("[data-toggle-integration]");
  if (toggleIntegrationBtn) { toggleIntegration(toggleIntegrationBtn.dataset.toggleIntegration); return; }
  if (event.target.closest("[data-add-webhook]")) { addWebhook(); return; }
  const removeWebhookBtn = event.target.closest("[data-remove-webhook]");
  if (removeWebhookBtn) { removeWebhook(removeWebhookBtn.dataset.removeWebhook); return; }

  // Chip list add/remove (pipeline stages, candidate statuses, document types, IP allowlist)
  const addChipBtn = event.target.closest("[data-add-chip]");
  if (addChipBtn) {
    const key = addChipBtn.dataset.addChip;
    const category = state.activeSettingsCategory;
    const input = document.querySelector(`[data-chip-input="${key}"]`);
    const value = input?.value.trim();
    if (!value) return;
    const list = getWorkingCategoryList(category, key);
    list.push(value);
    input.value = "";
    renderSettings();
    return;
  }
  const removeChipBtn = event.target.closest("[data-remove-chip]");
  if (removeChipBtn) {
    const [key, idxStr] = removeChipBtn.dataset.removeChip.split(":");
    const category = state.activeSettingsCategory;
    const list = getWorkingCategoryList(category, key);
    list.splice(Number(idxStr), 1);
    renderSettings();
    return;
  }

  // Job/offer template add/remove (recruitment)
  const addTemplateBtn = event.target.closest("[data-add-template]");
  if (addTemplateBtn) {
    const key = addTemplateBtn.dataset.addTemplate;
    const list = getWorkingCategoryList("recruitment", key);
    list.push({ id: `tmpl_${Date.now()}`, name: "New template", body: "" });
    renderSettings();
    return;
  }
  const removeTemplateBtn = event.target.closest("[data-remove-template]");
  if (removeTemplateBtn) {
    const [key, templateId] = removeTemplateBtn.dataset.removeTemplate.split(":");
    confirmDestructive("Delete template", "This template will be permanently removed.", "Delete", () => {
      const list = getWorkingCategoryList("recruitment", key);
      const next = list.filter((t) => t.id !== templateId);
      list.length = 0;
      list.push(...next);
      $("#previewModal").hidden = true;
      renderSettings();
    });
    return;
  }

  // Email template add/remove
  if (event.target.closest("[data-add-email-template]")) {
    const list = getWorkingCategoryList("email", "templates");
    list.push({ id: `tmpl_${Date.now()}`, name: "New template", subject: "", body: "" });
    renderSettings();
    return;
  }
  const removeEmailTemplateBtn = event.target.closest("[data-remove-email-template]");
  if (removeEmailTemplateBtn) {
    const templateId = removeEmailTemplateBtn.dataset.removeEmailTemplate;
    confirmDestructive("Delete template", "This email template will be permanently removed.", "Delete", () => {
      const list = getWorkingCategoryList("email", "templates");
      const next = list.filter((t) => t.id !== templateId);
      list.length = 0;
      list.push(...next);
      $("#previewModal").hidden = true;
      renderSettings();
    });
    return;
  }

  const confirmYes = event.target.closest("[data-confirm-action-yes]");
  if (confirmYes && pendingConfirmAction) {
    const action = pendingConfirmAction;
    pendingConfirmAction = null;
    action();
    return;
  }
});

document.addEventListener("change", (event) => {
  const userRoleSelect = event.target.closest("[data-user-role]");
  if (userRoleSelect) { changeUserRole(userRoleSelect.dataset.userRole, userRoleSelect.value); return; }
  if (event.target.closest("#settingsMfaToggle")) { toggleMfa(event.target.checked); return; }
});

document.addEventListener("input", (event) => {
  // Live-update the % label next to each AI match-weight slider as it's dragged, and
  // keep the six sliders roughly summing to 100 so the "rebalanced to 100%" note is true.
  if (event.target.matches("[data-weight]")) {
    const label = event.target.closest(".weight-slider")?.querySelector("strong");
    if (label) label.textContent = event.target.value;
    return;
  }
  // Recruitment/compliance/security text fields typed into a template textarea/input
  // update the in-memory working list directly so Save picks up the latest value.
  const templateField = event.target.closest("[data-template-field]");
  if (templateField) {
    const [key, templateId, field] = templateField.dataset.templateField.split(":");
    const list = getWorkingCategoryList("recruitment", key);
    const item = list.find((t) => t.id === templateId);
    if (item) item[field] = event.target.value;
    return;
  }
  const emailTemplateField = event.target.closest("[data-email-template-field]");
  if (emailTemplateField) {
    const [templateId, field] = emailTemplateField.dataset.emailTemplateField.split(":");
    const list = getWorkingCategoryList("email", "templates");
    const item = list.find((t) => t.id === templateId);
    if (item) item[field] = event.target.value;
    return;
  }
});

$("#closePreview").addEventListener("click", () => { $("#previewModal").hidden = true; });
$("#previewModal").addEventListener("click", (event) => {
  if (event.target.id === "previewModal") $("#previewModal").hidden = true;
});

setInterval(refreshResumeQueue, 3000);

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function applyCurrentUserToChip() {
  if (!state.currentUser) return;
  $("#userChipInitials").textContent = initials(state.currentUser.name);
  if ($("#userChipName")) $("#userChipName").textContent = state.currentUser.name || "Account";
  $("#userChipRole").textContent = ROLE_LABELS[normalizeRole(state.currentUser.role)] || state.currentUser.role;
  if ($("#menuUserInitials")) $("#menuUserInitials").textContent = initials(state.currentUser.name);
  if ($("#menuUserName")) $("#menuUserName").textContent = state.currentUser.name || "Account";
  if ($("#menuUserRole")) $("#menuUserRole").textContent = ROLE_LABELS[normalizeRole(state.currentUser.role)] || state.currentUser.role;
  if ($("#menuUserEmail")) $("#menuUserEmail").textContent = state.currentUser.email || "";
}

async function startApp(user, token = getSessionToken()) {
  state.currentUser = user;
  saveSession(user, token);
  applyCurrentUserToChip();
  $("#appShell").hidden = false;
  $("#loginScreen").hidden = true;
  $("#landingPage").hidden = true;
  await load();
  applyRoleGating(); // always re-gate after full load, now that currentUser is confirmed set
}

async function showLoginScreen() {
  $("#appShell").hidden = true;
  $("#loginScreen").hidden = true;
  $("#landingPage").hidden = false;
  $("#loginSubmit").disabled = false;
}
function showAuthForm() {
  $("#landingPage").hidden = true;
  $("#loginScreen").hidden = false;
  $("#loginEmail")?.focus();
}
function backToLanding() {
  $("#loginScreen").hidden = true;
  $("#landingPage").hidden = false;
}
$$("[data-open-auth]").forEach((btn) => btn.addEventListener("click", showAuthForm));
$("[data-back-to-landing]")?.addEventListener("click", backToLanding);

// Login is a 2-step flow: enter email -> server tells us whether this is a brand-new/
// password-less account (show "create a password") or an existing one (show "enter password").
let loginStep = "email"; // "email" | "create-password" | "enter-password"
let loginEmailChecked = "";

function setLoginError(message) {
  $("#loginError").textContent = message;
  $("#loginError").hidden = !message;
}

// Known, server-authored messages are safe to show as-is (they're written for end users).
// Anything else — a network failure, a browser-level error, an unexpected runtime message —
// gets replaced with one plain, friendly line instead of whatever raw text came through.
const KNOWN_LOGIN_ERROR_PREFIXES = [
  "Enter a valid email", "Enter your email and password", "Enter your name", "This account has been disabled",
  "Incorrect email or password", "Password must be at least", "This account already has a password",
  "Too many", "That request couldn't be read", "Something went wrong"
];
function friendlyLoginError(error) {
  const message = String(error?.message || "").trim();
  if (KNOWN_LOGIN_ERROR_PREFIXES.some((prefix) => message.startsWith(prefix))) return message;
  return "We couldn't reach the server. Check your connection and try again.";
}

const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resetLoginStep() {
  loginStep = "email";
  loginEmailChecked = "";
  $("#loginEmail").disabled = false;
  $("#loginNameGroup").hidden = true;
  $("#loginRoleGroup").hidden = true;
  $("#loginPasswordGroup").hidden = true;
  $("#loginPasswordConfirmGroup").hidden = true;
  $("#loginRole").disabled = true;
  $("#loginPassword").disabled = true;
  $("#loginPasswordConfirm").disabled = true;
  $("#loginName").value = "";
  $("#loginPassword").value = "";
  $("#loginPasswordConfirm").value = "";
  $("#loginBack").hidden = true;
  $("#loginHeading").textContent = "Sign in";
  $("#loginSub").textContent = "Enter your work email to continue.";
  $(".login-submit-label").textContent = "Continue";
}

function showCreatePasswordStep(email) {
  loginStep = "create-password";
  loginEmailChecked = email;
  $("#loginEmail").disabled = true;
  $("#loginNameGroup").hidden = false;
  $("#loginRoleGroup").hidden = false;
  $("#loginPasswordGroup").hidden = false;
  $("#loginPasswordConfirmGroup").hidden = false;
  $("#loginRole").disabled = false;
  $("#loginPassword").disabled = false;
  $("#loginPasswordConfirm").disabled = false;
  $("#loginPasswordLabel").textContent = "Create a password";
  $("#loginPassword").autocomplete = "new-password";
  $("#loginBack").hidden = false;
  $("#loginHeading").textContent = "Create your account";
  $("#loginSub").textContent = "First time signing in with this email — set a password to continue.";
  $(".login-submit-label").textContent = "Create password & sign in";
  $("#loginName").focus();
}

function showEnterPasswordStep(email) {
  loginStep = "enter-password";
  loginEmailChecked = email;
  $("#loginEmail").disabled = true;
  $("#loginNameGroup").hidden = true;
  $("#loginPasswordGroup").hidden = false;
  $("#loginPasswordConfirmGroup").hidden = true;
  $("#loginPassword").disabled = false;
  $("#loginPasswordLabel").textContent = "Password";
  $("#loginPassword").autocomplete = "current-password";
  $("#loginBack").hidden = false;
  $("#loginHeading").textContent = "Sign in";
  $("#loginSub").textContent = "Welcome back. Enter your password to continue.";
  $(".login-submit-label").textContent = "Sign in";
  $("#loginPassword").focus();
}

$$("[data-toggle-password]").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.togglePassword);
    if (!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "Show" : "Hide";
  });
});

$("#loginEmail").addEventListener("input", () => {
  if (loginStep !== "email" && $("#loginEmail").value.trim() !== loginEmailChecked) resetLoginStep();
});

$("#loginBack").addEventListener("click", () => {
  resetLoginStep();
  $("#loginEmail").focus();
});

document.addEventListener("submit", (event) => {
  if (event.target && event.target.id === "complianceUploadForm") {
    event.preventDefault();
    uploadComplianceDocument(event.target);
  }
});

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("#loginEmail").value.trim();
  const name = $("#loginName").value.trim();
  const password = $("#loginPassword").value;
  const passwordConfirm = $("#loginPasswordConfirm").value;
  const submit = $("#loginSubmit");

  setLoginError("");

  if (!SIMPLE_EMAIL_PATTERN.test(email)) {
    setLoginError("Enter a valid email address, like name@company.com.");
    return;
  }

  submit.disabled = true;
  submit.classList.add("is-loading");
  $(".login-submit-spinner").hidden = false;
  try {
    if (loginStep === "email") {
      const result = await api("/auth/check-email", {
        method: "POST",
        body: JSON.stringify({ email })
      });
      if (result.needsPassword) {
        showCreatePasswordStep(email);
      } else {
        showEnterPasswordStep(email);
      }
      return;
    }

    if (loginStep === "create-password") {
      if (!name) {
        setLoginError("Enter your name.");
        return;
      }
      if (password !== passwordConfirm) {
        setLoginError("Passwords don't match.");
        return;
      }
      const role = $("#loginRole").value;
      const result = await api("/auth/set-password", {
        method: "POST",
        body: JSON.stringify({ email, name, password, role })
      });
      resetLoginStep();
      await startApp(result.user, result.token);
      return;
    }

    // loginStep === "enter-password"
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    resetLoginStep();
    await startApp(result.user, result.token);
  } catch (error) {
    setLoginError(friendlyLoginError(error));
  } finally {
    submit.disabled = false;
    submit.classList.remove("is-loading");
    $(".login-submit-spinner").hidden = true;
  }
});

async function logoutUser() {
  try {
    await api("/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    toast(friendlyLoginError(error));
  }
  state.currentUser = null;
  clearSession();
  resetLoginStep();
  showLoginScreen().catch((error) => toast(error.message));
}

$("#userChip").addEventListener("click", (event) => {
  event.stopPropagation();
  const menu = $("#sidebarProfileMenu");
  const opening = menu.hidden;
  if (opening) {
    closeNotificationPanel();
    closeSettingsOverlay();
  }
  menu.hidden = !opening;
  $("#userChip").setAttribute("aria-expanded", String(opening));
});
document.addEventListener("click", (event) => {
  const menu = $("#sidebarProfileMenu");
  if (!menu || menu.hidden) return;
  if (event.target.closest("#sidebarProfile")) return;
  closeProfileMenu();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#sidebarProfileMenu") && !$("#sidebarProfileMenu").hidden) {
    closeProfileMenu();
  }
});
document.addEventListener("click", (event) => {
  const actionBtn = event.target.closest("[data-profile-menu-action]");
  if (!actionBtn) return;
  $("#sidebarProfileMenu").hidden = true;
  $("#userChip").setAttribute("aria-expanded", "false");
  const action = actionBtn.dataset.profileMenuAction;
  if (action === "logout") logoutUser();
  else if (action === "profile") openSettingsOverlay("profile");
  else if (action === "settings") openSettingsOverlay();
  else if (action === "help") {
    const supportEmail = state.settingsData.settings.company?.supportEmail || "support@asjats.com";
    toast(`Need help? Reach us at ${supportEmail}`, "success");
  }
});

async function restoreAuthSession() {
  try {
    const result = await api("/auth/me");
    await startApp(result.user);
  } catch {
    showLoginScreen().catch((error) => toast(error.message));
  }
}

restoreAuthSession();
