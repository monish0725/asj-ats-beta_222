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
  candidatePageSize: 25,
  candidateFilters: { search: "", job: "", stage: "", experience: "", openToWork: "" },
  pipelineJobId: "",
  pipelineSearch: "",
  undoToken: "",
  aiChats: [],
  openedPreviousChatId: "",
  currentUser: null
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
    outreach: "full", reports: "full", compliance: "full", users: "full", clients: "full", ai: "full"
  },
  recruiter: {
    dashboard: "full", inbox: "full", candidates: "full", jobs: "full", pipeline: "full",
    outreach: "full", reports: "full", compliance: "full", users: "none", clients: "none", ai: "full"
  },
  account_manager: {
    dashboard: "view", inbox: "view", candidates: "view", jobs: "full", pipeline: "full",
    outreach: "view", reports: "full", compliance: "view", users: "none", clients: "none", ai: "view"
  },
  hiring_manager: {
    dashboard: "view", inbox: "none", candidates: "view", jobs: "view", pipeline: "full",
    outreach: "none", reports: "view", compliance: "none", users: "none", clients: "none", ai: "view"
  },
  viewer: {
    dashboard: "limited", inbox: "view", candidates: "view", jobs: "view", pipeline: "view",
    outreach: "none", reports: "view", compliance: "none", users: "none", clients: "none", ai: "view"
  }
};
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
  users: "users", clients: "clients", ai: "ai"
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

function loadSession() {
  try {
    const raw = sessionStorage.getItem("asjAtsSession");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(user) {
  sessionStorage.setItem("asjAtsSession", JSON.stringify(user));
}

function clearSession() {
  sessionStorage.removeItem("asjAtsSession");
}

function applyRoleGating() {
  $$(".nav").forEach((navButton) => {
    const moduleKey = NAV_MODULE_BY_VIEW[navButton.dataset.view];
    if (!moduleKey) return;
    const hidden = !canView(moduleKey);
    navButton.classList.toggle("role-hidden", hidden);
  });
  // If the user is currently parked on a view they've lost access to, send them somewhere they can see.
  if (state.view && NAV_MODULE_BY_VIEW[state.view] && !canView(NAV_MODULE_BY_VIEW[state.view])) {
    switchView("dashboard");
  }
  $$("[data-role-restricted]").forEach((el) => {
    const restricted = !canEdit(el.dataset.roleRestricted);
    el.classList.toggle("role-disabled", restricted);
    if (el.tagName === "BUTTON" || el.tagName === "SELECT" || el.tagName === "INPUT") el.disabled = restricted;
  });
  document.body.dataset.role = currentRoleKey();
}

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...options
  });
  const body = await res.json();
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

async function load() {
  const [data, dashboard, recommendations, systemStatus] = await Promise.all([api("/api/all"), api("/api/dashboard"), api("/api/recommendations"), api("/api/system-status")]);
  state.data = data;
  state.dashboard = dashboard;
  state.recommendations = recommendations;
  state.systemStatus = systemStatus;
  render();
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
  renderUsers();
  renderClients();
  renderSystemStatus();
  renderJobOptions();
  renderAiStrip();
  renderAiSnapshot();
  renderAiChatHistory();
  renderPreviousAiChats();
  applyRoleGating();
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
    ["Total files", inbox.length],
    ["Parsed", good],
    ["Partial", partial],
    ["Needs review", review]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
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

function renderInbox() {
  const resumes = state.data.websiteResumes.slice().sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  const uploaded = resumes.length;
  const parsed = resumes.filter((resume) => resume.processed).length;
  const review = resumes.filter((resume) => resume.needsReview || resume.extractionQuality === "poor").length;
  const pending = resumes.filter((resume) => !resume.processed && !resume.needsReview && resume.extractionQuality !== "poor").length;
  const queue = resumeQueueStats(resumes);
  if ($("#parseStatus")) {
    $("#parseStatus").innerHTML = [
      ["Uploaded", uploaded],
      ["Parsed", parsed],
      ["Needs Review", review],
      ["Remaining", pending]
    ].map(([label, value]) => `<span><strong>${value}</strong> ${label}</span>`).join("");
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
  $("#resumeInbox").innerHTML = `
    <div class="bulk-grid-toolbar">
      <label><input id="resumeTableSelectAll" type="checkbox" ${resumes.length && resumes.every((resume) => state.selectedResumes.has(resume.id)) ? "checked" : ""} /> Select all</label>
      <span>${state.selectedResumes.size} selected</span>
      <button class="secondary compact-button" data-bulk-resume-action="parse" data-role-restricted="inbox">Parse selected</button>
      <button class="secondary compact-button" data-bulk-resume-action="review" data-role-restricted="inbox">Mark review</button>
      <button class="secondary compact-button danger" data-bulk-resume-action="delete" data-role-restricted="inbox">Delete selected</button>
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
          <th>Match Score</th>
          <th>Open To Work</th>
          <th>Parse Status</th>
          <th>Last Updated</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${resumes.map((resume) => {
    const candidate = resume.candidateId ? state.data.candidates.find((item) => item.id === resume.candidateId) : null;
    const displayName = candidate?.name || inferResumeName(resume);
    const role = candidate?.currentRole || inferRoleFromResume(resume);
    const experience = candidate?.experienceYears ?? inferExperienceFromText(resume.resumeText);
    const skills = candidate?.skills?.length ? candidate.skills : inferSkillsFromResume(resume);
    const location = candidate?.location || inferLocationFromResume(resume);
    const matchScore = getCandidateMatchScore(candidate?.id || resume.candidateId);
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
  const pageCount = Math.max(1, Math.ceil(candidates.length / state.candidatePageSize));
  state.candidatePage = Math.min(state.candidatePage, pageCount);
  const pageStart = (state.candidatePage - 1) * state.candidatePageSize;
  const visible = candidates.slice(pageStart, pageStart + state.candidatePageSize);
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
            ${sortableTh("updated", "Last Activity")}
            <th class="actions-col">Actions</th>
          </tr>
        </thead>
        <tbody>
        ${visible.map((candidate) => {
    const bestMatch = candidateBestMatch(candidate);
    const stage = candidatePipelineStage(candidate);
    const openToWork = inferOpenToWork(candidate, null);
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
      <span>${candidates.length} candidate(s) · Page ${state.candidatePage} of ${pageCount}</span>
      <div class="table-actions">
        <button data-candidate-page="${state.candidatePage - 1}" ${state.candidatePage <= 1 ? "disabled" : ""}>Previous</button>
        <button data-candidate-page="${state.candidatePage + 1}" ${state.candidatePage >= pageCount ? "disabled" : ""}>Next</button>
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
      const openOk = !filters.openToWork || (filters.openToWork === "yes" ? open : !open);
      const booleanOk = !state.booleanQuery.trim() || result?.matched;
      return searchOk && jobOk && stageOk && experienceOk && openOk && booleanOk;
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
        ${idx > 0 ? `<button data-move="${app.id}" data-stage="${pipelineStages[idx - 1]}">Back</button>` : ""}
        ${idx < pipelineStages.length - 1 ? `<button data-move="${app.id}" data-stage="${pipelineStages[idx + 1]}">Move to ${stageLabels[pipelineStages[idx + 1]] || pipelineStages[idx + 1]}</button>` : ""}
        ${isFinal ? `<button class="selected-action" data-decision="${app.id}" data-result="Selected">Selected</button><button class="rejected-action" data-decision="${app.id}" data-result="Rejected">Rejected</button>` : ""}
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
  $("#outreachAnalytics").innerHTML = [
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

function renderCompliance() {
  if (!$("#visaCards")) return;
  const visaCounts = countBy(state.data.candidates, inferVisa);
  const clearanceCounts = countBy(state.data.candidates, inferClearance);
  $("#visaCards").innerHTML = ["Australian Citizen", "Permanent Resident", "Full Work Rights", "Student Visa", "Sponsorship Required", "Needs Verification"]
    .map((label) => `<div><span>${label}</span><strong>${visaCounts[label] || 0}</strong></div>`).join("");
  $("#clearanceCards").innerHTML = ["No Clearance", "Baseline", "NV1", "NV2", "TSPV", "Clearance"]
    .map((label) => `<div><span>${label}</span><strong>${clearanceCounts[label] || 0}</strong></div>`).join("");
  const queue = state.data.candidates.filter((candidate) => inferVisa(candidate) === "Needs Verification" || inferClearance(candidate) === "No Clearance").slice(0, 8);
  $("#complianceRows").innerHTML = queue.map((candidate) => `
    <article class="card">
      <div class="card-head">
        <div>
          <strong>${escapeHtml(candidate.name)}</strong>
          <div class="muted">${escapeHtml(candidate.currentRole || "Candidate")} · ${escapeHtml(candidate.location || "Location not set")}</div>
        </div>
        <span class="badge warn">Review</span>
      </div>
      <div class="job-meta">
        <span>${inferVisa(candidate)}</span>
        <span>${inferClearance(candidate)}</span>
      </div>
      <div class="card-actions"><button data-preview="${candidate.id}">Open Profile</button></div>
    </article>
  `).join("") || `<div class="activity">No compliance review items.</div>`;
}

function renderUsers() {
  if (!$("#userCards")) return;
  const roles = [
    ["Admin", "User management, reports, audit monitoring, compliance oversight"],
    ["Recruiter", "Candidate search, job creation, pipeline movement, outreach"],
    ["Account Manager", "Job management, pipeline review, reports"],
    ["Hiring Manager", "View assigned jobs, review candidates, interview feedback"],
    ["Viewer", "Read-only access for reports and pipeline visibility"]
  ];
  const actualUsers = state.data.users || [];
  const roleKeyMap = {
    "Admin": "admin", "Recruiter": "recruiter", "Account Manager": "account_manager",
    "Hiring Manager": "hiring_manager", "Viewer": "viewer"
  };
  $("#userCards").innerHTML = roles.map(([role, detail]) => {
    const dbKey = roleKeyMap[role] || role.toLowerCase();
    const count = actualUsers.filter((user) => user.role === dbKey).length;
    return `<div><strong>${role}</strong><span>${detail}</span><em>${count} account${count === 1 ? "" : "s"}</em></div>`;
  }).join("");
  const rows = [
    ["Dashboard",   "Full", "Full", "View",   "View",   "Limited"],
    ["Inbox",       "Full", "Full", "View",   "No access", "View"],
    ["Candidates",  "Full", "Full", "View",   "View",   "View"],
    ["Jobs",        "Full", "Full", "Approve","View",   "View"],
    ["Pipeline",    "Full", "Full", "Review", "Full",   "View"],
    ["Outreach",    "Full", "Full", "View",   "No access", "No access"],
    ["Reports",     "Full", "Full", "Full",   "View",   "View"],
    ["Compliance",  "Full", "Manage","View",  "No access", "No access"],
    ["Users",       "Full", "No access","No access","No access","No access"]
  ];
  $("#roleMatrix").innerHTML = `
    <table>
      <thead><tr><th>Module</th><th>Admin</th><th>Recruiter</th><th>Account Manager</th><th>Hiring Manager</th><th>Viewer</th></tr></thead>
      <tbody>${rows.map((row) => `<tr>${row.map((cell, i) => `<td${i === 0 ? "" : ` class="cell-${cell.toLowerCase().replace(/ /g,"_")}"`}>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
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
  const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "asj-candidates.csv";
  link.click();
  URL.revokeObjectURL(url);
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

async function deleteCandidate(candidateId) {
  const candidate = state.data.candidates.find((item) => item.id === candidateId);
  if (!candidate) return;
  if (!confirm(`Are you sure you want to delete ${candidate.name}? This also removes their job pipeline entries.`)) return;
  const result = await api(`/api/candidates/${candidateId}`, { method: "DELETE" });
  await applyServerState(result);
  toast(`${candidate.name} deleted`);
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
  if (moduleKey && !canView(moduleKey)) {
    toast("You don't have access to that section.");
    view = "dashboard";
  }
  state.view = view;
  $$(".nav").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  const activeNav = $(`.nav[data-view="${view}"]`);
  $("#pageTitle").textContent = activeNav ? activeNav.textContent.replace(/^[A-Z]{2}/, "").trim() : view;
  renderAiStrip();
  window.scrollTo({ top: 0, behavior: "smooth" });
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
          <div><span>Contact</span><strong>${escapeHtml(candidate.email || "No email")}</strong></div>
        </div>
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
      </section>
      <section>
        <h3>Pipeline History</h3>
        ${apps.length ? apps.map((app) => `<div class="profile-row"><strong>${escapeHtml(app.job?.title || "Job")}</strong><span>${escapeHtml(stageLabels[normalizeStageName(app.stage)] || normalizeStageName(app.stage))}${app.decision ? ` · ${escapeHtml(app.decision)}` : ""}</span><em>${formatDate(app.updatedAt || app.appliedAt)}</em></div>`).join("") : `<p class="muted">No pipeline history.</p>`}
      </section>
      <section>
        <h3>Recruiter Notes</h3>
        <p>${escapeHtml(apps.map((app) => app.notes).filter(Boolean).join(" ") || "No recruiter notes yet.")}</p>
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
  $("#candidatePreviewBody").innerHTML = `
    <div class="resume-preview-grid">
      <div class="file-frame">
        ${resume.resumeUrl?.startsWith("/uploads/") && isEmbeddable ? `<iframe src="${resume.resumeUrl}" title="Resume file preview"></iframe>` : `<div class="empty-state"><strong>Preview shown as parsed text</strong><span>This file type cannot be rendered by the browser, but the resume content is shown on this page.</span></div>`}
      </div>
      <div class="parsed-frame">
        <div class="review-head">
          <h3>Parsed Text</h3>
          <div class="table-actions">
            ${resume.resumeUrl?.startsWith("/uploads/") ? `<a class="button-link" href="${resume.resumeUrl}" target="_blank" rel="noreferrer">${isEmbeddable ? "Open File" : "Download File"}</a>` : ""}
            <button data-save-resume="${resume.id}" class="primary-mini">Save Update</button>
            <button data-delete-resume="${resume.id}" class="danger">Delete</button>
          </div>
        </div>
        <textarea id="resumeReviewText" class="review-textarea" rows="18">${escapeHtml(resume.resumeText || "")}</textarea>
      </div>
    </div>
  `;
  $("#previewModal").hidden = false;
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
});
$("#search").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
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
$("#outreachType").addEventListener("change", renderOutreach);
$("#outreachCandidate").addEventListener("change", renderOutreach);
$("#outreachCandidateSearch").addEventListener("input", renderOutreach);
$("#undoDelete").addEventListener("click", undoDelete);
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
["#candidateJobFilter", "#candidateStageFilter", "#candidateExperienceFilter", "#candidateOpenFilter"].forEach((selector) => {
  $(selector)?.addEventListener("change", (event) => {
    const keys = {
      "#candidateJobFilter": "job",
      "#candidateStageFilter": "stage",
      "#candidateExperienceFilter": "experience",
      "#candidateOpenFilter": "openToWork"
    };
    state.candidateFilters[keys[selector]] = event.target.value;
    state.candidatePage = 1;
    renderCandidates();
  });
});
$("#candidateBulkAction")?.addEventListener("change", (event) => runCandidateBulkAction(event.target.value));
$("#exportCandidates")?.addEventListener("click", exportCandidates);
$("#downloadReportPdf")?.addEventListener("click", downloadReportPdf);
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
    const input = document.getElementById(clear.dataset.clearInput);
    if (input) {
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
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
  const deleteResumeButton = event.target.closest("[data-delete-resume]");
  if (deleteResumeButton) deleteResume(deleteResumeButton.dataset.deleteResume);
  const saveResumeButton = event.target.closest("[data-save-resume]");
  if (saveResumeButton) saveResumeReview(saveResumeButton.dataset.saveResume);
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
});
document.addEventListener("change", (event) => {
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
  $("#userChipRole").textContent = ROLE_LABELS[normalizeRole(state.currentUser.role)] || state.currentUser.role;
}

async function startApp(user) {
  state.currentUser = user;
  applyCurrentUserToChip();
  $("#appShell").hidden = false;
  $("#loginScreen").hidden = true;
  await load();
}

async function showLoginScreen() {
  $("#appShell").hidden = true;
  $("#loginScreen").hidden = false;
  $("#loginSubmit").disabled = false;
}

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
  $("#loginSubmit").textContent = "Continue";
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
  $("#loginSubmit").textContent = "Create password & sign in";
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
  $("#loginSubmit").textContent = "Sign in";
  $("#loginPassword").focus();
}

$("#loginEmail").addEventListener("input", () => {
  if (loginStep !== "email" && $("#loginEmail").value.trim() !== loginEmailChecked) resetLoginStep();
});

$("#loginBack").addEventListener("click", () => {
  resetLoginStep();
  $("#loginEmail").focus();
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
      await startApp(result.user);
      return;
    }

    // loginStep === "enter-password"
    const result = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    resetLoginStep();
    await startApp(result.user);
  } catch (error) {
    setLoginError(friendlyLoginError(error));
  } finally {
    submit.disabled = false;
  }
});

$("#userChip").addEventListener("click", async () => {
  try {
    await api("/auth/logout", { method: "POST", body: JSON.stringify({}) });
  } catch (error) {
    toast(friendlyLoginError(error));
  }
  state.currentUser = null;
  clearSession();
  resetLoginStep();
  showLoginScreen().catch((error) => toast(error.message));
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