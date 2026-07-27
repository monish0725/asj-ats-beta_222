import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { connect as connectNet } from "node:net";
import { basename, extname, join, resolve } from "node:path";
import { connect as connectTls } from "node:tls";
import { fileURLToPath } from "node:url";
import { inflateRawSync, inflateSync } from "node:zlib";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { importJobFromUrl } from "./jobImporter.js";
import authRoutes from "./routes/authRoutes.js";
import usersRoutes from "./routes/usersRoutes.js";
import { verifyToken, AUTH_COOKIE_NAME } from "./utils/jwt.js";
import { findUserById } from "./models/userModel.js";
import { canEdit as roleCanEdit, canView as roleCanView, moduleForApiPath, SETTINGS_CATEGORIES } from "./rbac.js";
import { matchCandidateToJob, matchCandidateToJobSync, rankMatches } from "./matching/index.js";
import { SCORE_WEIGHTS } from "./matching/scoreAggregator.js";
import { analyzeResume } from "./matching/atsAnalyzer.js";

// Computes (or recomputes) the ATS analysis report for one candidate and caches it on
// the candidate record. Picks the best-matching open job (if any) as job context for the
// job-relevance-dependent metrics, without creating pipeline applications the way
// assignCandidateToBestJobs does -- this is a read-only analysis, not a matching action.
function refreshAtsReport(db, candidate) {
  const openJobs = db.jobs.filter((job) => job.status === "open");
  const best = openJobs.length
    ? rankMatches(openJobs.map((job) => ({ job, ...scoreMatch(candidate, job, db) })))[0]
    : null;
  candidate.atsReport = analyzeResume(candidate, best ? best.job : null);
  return candidate.atsReport;
}

// Converts the simplified 6-slider weight model shown in AI Settings into the matching
// engine's full 9-component weight table. requiredSkills/preferredSkills split from the
// single "skills" slider at the same 75/25 ratio as the spec default (30:10), and
// roleSimilarity/resumeQuality stay fixed at their spec values (5 each) since they
// aren't exposed as sliders -- the other six are scaled to fill the remaining budget.
function matchWeightsFromSettings(db) {
  const configured = db.settings?.ai?.matchWeights;
  if (!configured) return undefined; // caller falls back to the built-in SCORE_WEIGHTS
  const { skills = 40, experience = 25, education = 10, certifications = 10, projects = 10, semantic = 5 } = configured;
  const total = skills + experience + education + certifications + projects + semantic;
  if (!total) return undefined;
  const fixed = SCORE_WEIGHTS.roleSimilarity + SCORE_WEIGHTS.resumeQuality; // 10
  const budget = 100 - fixed; // 90
  const scale = budget / total;
  return {
    requiredSkills: skills * scale * 0.75,
    preferredSkills: skills * scale * 0.25,
    experience: experience * scale,
    education: education * scale,
    projects: projects * scale,
    certifications: certifications * scale,
    roleSimilarity: SCORE_WEIGHTS.roleSimilarity,
    resumeQuality: SCORE_WEIGHTS.resumeQuality,
    semantic: semantic * scale
  };
}

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");
loadEnv();
const PUBLIC_DIR = join(ROOT, "public");
const DB_FILE = process.env.DB_FILE ? resolve(process.env.DB_FILE) : join(ROOT, "data", "db.json");
const UPLOAD_DIR = join(ROOT, "data", "uploads");
const PORT = Number(process.env.PORT || 4200);
const HOST = process.env.HOST || "0.0.0.0";
const USE_SUPABASE_DB = process.env.APP_DB_PROVIDER === "supabase" || Boolean(process.env.APP_STATE_TABLE);
const APP_STATE_TABLE = process.env.APP_STATE_TABLE || "app_state";
const APP_STATE_KEY = process.env.APP_STATE_KEY || "default";
const SUPABASE_URL = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "resumes";
const USE_SUPABASE_STORAGE = process.env.STORAGE_PROVIDER === "supabase" || Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_BULK_UPLOAD_BYTES = Number(process.env.MAX_BULK_UPLOAD_BYTES || 1024 * 1024 * 1024);
const MAX_BULK_RESUMES = Number(process.env.MAX_BULK_RESUMES || 5000);
const ALLOWED_RESUME_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"]);
const IMAGE_RESUME_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"]);
const RESUME_WORKERS = Number(process.env.RESUME_WORKERS || 6);
let resumeQueueRunning = false;
let appDbCache = null;
let appDbPool = null;
let appDbPersist = Promise.resolve();

const KNOWN_SKILLS = [
  "React", "JavaScript", "TypeScript", "Node.js", "Express", "REST", "GraphQL", "PostgreSQL", "MongoDB",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "CI/CD", "Jenkins", "Python", "Django",
  "SQL", "MySQL", "Power BI", "Tableau", "Data Analysis", "Healthcare", "Security", "Monitoring", "Agile", "Accessibility",
  "Machine Learning", "Artificial Intelligence", "AI", "ML", "Deep Learning", "TensorFlow", "Keras", "Scikit-learn",
  "Pandas", "NumPy", "Matplotlib", "OpenCV", "Computer Vision", "NLP", "FastAPI", "Figma", "UI/UX", "IoT",
  "MediaPipe", "Vosk", "Twilio", "SMTP", "GitHub", "C", "Java", "Spring Boot", "Kafka", "MLOps"
];

const ROLE_KEYWORDS = [
  { category: "AI/ML", title: "AI/ML Engineer", terms: ["machine learning", "artificial intelligence", "deep learning", "tensorflow", "keras", "computer vision", "opencv", "nlp", "ml engineer", "data science"] },
  { category: "Data", title: "Data Analyst", terms: ["data analyst", "sql", "power bi", "tableau", "dashboard", "data quality", "analytics"] },
  { category: "Full Stack", title: "Full Stack Developer", terms: ["full stack", "react", "node.js", "rest api", "frontend", "backend", "mongodb", "postgresql"] },
  { category: "Cloud/DevOps", title: "Cloud DevOps Engineer", terms: ["devops", "aws", "docker", "kubernetes", "terraform", "ci/cd", "jenkins", "monitoring"] },
  { category: "Design", title: "UI/UX Designer", terms: ["ui/ux", "figma", "prototype", "user research", "design"] },
  { category: "Backend", title: "Backend Engineer", terms: ["spring boot", "java", "microservices", "kafka", "backend"] }
];

function sqlIdentifier(name) {
  const value = String(name || "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error(`Invalid SQL identifier: ${value}`);
  return `"${value.replace(/"/g, "\"\"")}"`;
}

const APP_STATE_TABLE_SQL = sqlIdentifier(APP_STATE_TABLE);

const STAGES = ["Applied", "Matched Candidates", "Interview", "Awaiting Decision", "Final Decision"];
const STAGE_ALIASES = {
  "Applied candidates": "Applied",
  Screened: "Matched Candidates",
  Screening: "Matched Candidates",
  "Best match": "Matched Candidates",
  "Matched Candidate": "Matched Candidates",
  "Best Match": "Matched Candidates",
  "Best Matches": "Matched Candidates",
  Interview: "Interview",
  "Interview Round 1": "Interview",
  "Interview Round 2": "Interview",
  "Awaiting decision": "Awaiting Decision",
  "HR Round": "Awaiting Decision",
  "Follow-Up": "Awaiting Decision",
  Offer: "Final Decision",
  Hired: "Final Decision",
  "Final decision": "Final Decision",
  Selected: "Final Decision",
  Rejected: "Final Decision",
  Matched: "Matched Candidates"
};

mkdirSync(UPLOAD_DIR, { recursive: true });

// Allowed browser origins for API/auth handlers. These endpoints authenticate with
// an httpOnly session cookie, so production should set CORS_ORIGIN to the Vercel
// frontend origin. Multiple origins can be comma-separated. Railway deployments
// also expose the frontend from the same service host, so include that public host
// automatically when Railway provides it.
function normalizeOrigin(origin) {
  if (!origin) return "";
  try {
    return new URL(origin).origin;
  } catch {
    return String(origin).replace(/\/+$/, "");
  }
}

const ALLOWED_ORIGINS = [
  process.env.CORS_ORIGIN,
  process.env.FRONTEND_URL,
  process.env.PUBLIC_URL,
  process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ""
]
  .join(",")
  .split(",")
  .map((origin) => normalizeOrigin(origin.trim()))
  .filter(Boolean);

function requestHost(req) {
  return String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "").split(",")[0].trim();
}

function isSameRequestOrigin(req, origin) {
  if (!origin) return false;
  try {
    return new URL(origin).host === requestHost(req);
  } catch {
    return false;
  }
}

function resolveAllowedOrigin(req) {
  const origin = normalizeOrigin(req?.headers?.origin);
  if (!origin) return "";
  if (!ALLOWED_ORIGINS.length) return origin; // no explicit allowlist configured (e.g. local dev)
  return ALLOWED_ORIGINS.includes(origin) || isSameRequestOrigin(req, origin) ? origin : "";
}

const authApp = express();
const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS || 1);
authApp.set("trust proxy", TRUST_PROXY_HOPS);
authApp.use((req, res, next) => {
  cors({
    origin(origin, callback) {
      if (!origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin) || isSameRequestOrigin(req, origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true
  })(req, res, next);
});
authApp.use(cookieParser());
authApp.use(express.json({ limit: "2mb" }));
authApp.use("/auth", authRoutes);
authApp.use("/api/users", usersRoutes);
authApp.use((error, req, res, next) => {
  if (error.type === "entity.parse.failed" || error instanceof SyntaxError) {
    return res.status(400).json({ error: "That request couldn't be read. Please try again." });
  }
  console.error(error);
  const status = error.statusCode || 500;
  res.status(status).json({ error: status === 500 ? "Something went wrong. Please try again." : error.message });
});

function handleAuthRequest(req, res) {
  return new Promise((resolveRequest) => {
    res.once("finish", resolveRequest);
    res.once("close", resolveRequest);
    authApp(req, res);
  });
}

// The /api/* routes below are handled by the raw http server rather than the Express
// authApp, so they don't get cookie-parser or requireAuth for free. This re-implements
// just enough of that (cookie parsing + JWT verification + a fresh DB lookup) so every
// API route -- not just /auth and /api/users -- requires a valid session and respects
// each user's role.
function parseCookieHeader(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    const key = pair.slice(0, index).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(pair.slice(index + 1).trim());
    } catch {
      out[key] = pair.slice(index + 1).trim();
    }
  }
  return out;
}

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function authenticateApiRequest(req) {
  const token = parseCookieHeader(req.headers.cookie)[AUTH_COOKIE_NAME] || bearerToken(req);
  if (!token) return null;
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return null;
  }
  try {
    const user = await findUserById(payload.sub);
    if (!user || user.status === "disabled") return null;
    return user;
  } catch (error) {
    console.error("[auth] could not load user for API request:", error.message);
    return null;
  }
}

function loadEnv() {
  for (const file of [resolve(ROOT, ".env"), resolve(ROOT, "../.env")]) {
    if (!existsSync(file)) continue;
    try {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index === -1) continue;
        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) process.env[key] = value;
      }
    } catch (error) {
      console.warn(`Skipping env file ${file}: ${error.message}`);
    }
  }
}

const SETTINGS_LABELS = {
  profile: "Profile", company: "Company", clients: "Client", users: "User & Role",
  recruitment: "Recruitment", resumeParsing: "Resume Parsing", ai: "AI", email: "Email & Notifications",
  notifications: "Notification", compliance: "Compliance", integrations: "Integrations",
  security: "Security", storage: "File & Storage", reports: "Reports & Export",
  appearance: "Appearance", system: "System"
};

// Deliberately simple, dependency-free validation: every incoming field must already
// exist in that category's defaults (no arbitrary key injection) and must roughly match
// the type of its default value. This is enough to stop obviously malformed writes
// without hand-writing a bespoke schema per category.
function validateSettingsPatch(category, body) {
  const defaults = defaultSettings()[category];
  if (!defaults) return `Unknown settings category: ${category}`;
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Request body must be an object";
  for (const [key, value] of Object.entries(body)) {
    if (!(key in defaults)) return `Unknown setting: ${key}`;
    const expected = defaults[key];
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${key} must be an object`;
      continue; // shallow-check nested objects (e.g. matchWeights, integrations.*)
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(value)) return `${key} must be a list`;
      continue;
    }
    if (typeof expected === "number" && (typeof value !== "number" || Number.isNaN(value))) return `${key} must be a number`;
    if (typeof expected === "boolean" && typeof value !== "boolean") return `${key} must be true or false`;
    if (typeof expected === "string" && typeof value !== "string") return `${key} must be text`;
  }
  return null;
}

function mergeSettingsPatch(current, body) {
  const next = { ...current };
  for (const [key, value] of Object.entries(body)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value) && next[key] && typeof next[key] === "object") {
      next[key] = { ...next[key], ...value };
    } else {
      next[key] = value;
    }
  }
  return next;
}

function defaultSettings() {
  return {
    company: {
      companyName: "ASJ Recruitment Solutions",
      logoUrl: "",
      website: "https://www.asjats.com",
      supportEmail: "support@asjats.com",
      phone: "",
      address: "",
      timezone: "Asia/Kolkata",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
      workingHoursStart: "09:00",
      workingHoursEnd: "18:00",
      brandColor: "#0d9488"
    },
    clients: {
      defaultClientOwner: "",
      clientPortalEnabled: false,
      clientBillingContact: "",
      clientNotesVisibleToClient: false
    },
    recruitment: {
      pipelineStages: ["Applied", "Matched Candidates", "Interview", "Awaiting Decision", "Final Decision"],
      candidateStatuses: ["New", "In Review", "Shortlisted", "Interviewing", "Offered", "Hired", "Rejected", "Withdrawn"],
      jobTemplates: [
        { id: "tmpl_default", name: "Standard Job Post", body: "We are hiring for {{role}}. {{description}}" }
      ],
      offerTemplates: [
        { id: "offer_default", name: "Standard Offer Letter", body: "Dear {{name}}, we are pleased to offer you the position of {{role}}." }
      ],
      autoAdvanceOnHighMatch: false,
      minMatchScoreForAutoShortlist: 75
    },
    resumeParsing: {
      supportedFormats: [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"],
      ocrEnabled: true,
      duplicateDetection: true,
      duplicateMatchThreshold: 90,
      autoParseOnUpload: true
    },
    ai: {
      provider: process.env.COHERE_API_KEY ? "cohere" : "local",
      apiKeyConfigured: Boolean(process.env.COHERE_API_KEY),
      matchWeights: { skills: 40, experience: 25, education: 10, certifications: 10, projects: 10, semantic: 5 },
      aiOutreachDrafting: true,
      aiResumeSummaries: true,
      aiMatchExplanations: true
    },
    email: {
      smtpHost: "",
      smtpPort: 587,
      smtpUser: "",
      smtpSecure: true,
      fromName: "ASJ Recruitment Team",
      fromEmail: "",
      templates: [
        { id: "tmpl_invite", name: "Interview Invite", subject: "Interview Invitation", body: "Hi {{name}}, we'd like to invite you to interview for {{role}}." },
        { id: "tmpl_reject", name: "Rejection", subject: "Update on your application", body: "Hi {{name}}, thank you for your interest in {{role}}." }
      ]
    },
    notifications: {
      emailOnNewCandidate: true,
      emailOnStageChange: true,
      emailOnInterviewScheduled: true,
      digestFrequency: "daily",
      inAppNotifications: true
    },
    compliance: {
      documentTypes: ["Government ID", "Work Visa", "Background Check", "Reference Letter", "Signed Offer"],
      expiryReminderDays: 30,
      requireVerificationBeforeOffer: true
    },
    integrations: {
      googleCalendar: { connected: false },
      outlook: { connected: false },
      teams: { connected: false },
      zoom: { connected: false },
      linkedin: { connected: false },
      webhooks: []
    },
    security: {
      passwordMinLength: 8,
      passwordRequireNumber: true,
      passwordRequireSymbol: true,
      passwordRequireUppercase: true,
      sessionTimeoutMinutes: 60,
      ipAllowlist: [],
      mfaRequiredForAdmins: false
    },
    storage: {
      maxUploadSizeMb: 10,
      maxBulkUploadSizeMb: 1024,
      allowedFileTypes: [".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".gif"],
      storageProvider: "local"
    },
    reports: {
      defaultExportFormat: "csv",
      includeArchivedInExports: false,
      scheduledReports: []
    },
    appearance: {
      theme: "light",
      language: "en",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h"
    },
    system: {
      maintenanceMode: false,
      maintenanceMessage: "",
      lastBackupAt: ""
    }
  };
}

function ensureBetaCollections(db) {
  db.outreachLog ||= [];
  db.outreachFollowups ||= [];
  db.aiChats ||= [];
  db.deletedCandidates ||= [];
  db.websiteResumes ||= [];
  db.notificationReads ||= {}; // { [userId]: [activityId, ...] }
  db.settings ||= defaultSettings();
  // Backfill any settings categories added in later versions of the app onto older db.json files.
  const defaults = defaultSettings();
  for (const category of Object.keys(defaults)) {
    db.settings[category] = { ...defaults[category], ...(db.settings[category] || {}) };
  }
  db.settingsAudit ||= []; // [{ id, category, field, before, after, actorId, actorName, at }]
  db.userProfiles ||= {}; // { [userId]: { phone, photoUrl } } -- extra profile fields not owned by userModel.js
  // Targeted, admin-triggered notifications for a specific user (e.g. "your role was
  // changed") -- separate from computeNotifications' auto-derived feed since events
  // like role/permission changes happen in routes/usersRoutes.js, which isn't part of
  // this package; this queue is the integration point for that (see POST /api/user-notifications).
  db.directNotifications ||= []; // [{ id, userId, category, title, message, targetView, createdAt }]
  for (const resume of db.websiteResumes) {
    resume.queueStatus ||= resume.processed ? "Parsed" : resume.extractionQuality === "poor" ? "Failed" : resume.resumeText ? "Uploaded" : "Uploaded";
  }
  for (const job of db.jobs || []) {
    job.priority ||= "Medium";
    job.clearance ||= "No clearance";
    job.startDate ||= "";
    job.closingDate ||= "";
  }
  for (const candidate of db.candidates || []) {
    candidate.complianceDocuments ||= [];
    candidate.tags ||= [];
    if (candidate.openToWork !== undefined) candidate.openToWork = Boolean(candidate.openToWork);
    if (candidate.hotList === undefined) candidate.hotList = Boolean(candidate.openToWork);
    candidate.availability ||= "";
    candidate.currentCompany ||= "";
    candidate.employmentStatus ||= "";
    candidate.noticePeriod ||= "";
  }
  return db;
}

function readDb() {
  if (appDbCache) return ensureBetaCollections(JSON.parse(JSON.stringify(appDbCache)));
  return ensureBetaCollections(JSON.parse(readFileSync(DB_FILE, "utf8")));
}

function writeDb(db) {
  const normalized = ensureBetaCollections(db);
  appDbCache = normalized;
  writeFileSync(DB_FILE, `${JSON.stringify(normalized, null, 2)}\n`);
  if (USE_SUPABASE_DB && appDbPool) {
    appDbPersist = appDbPersist
      .catch(() => {})
      .then(() => persistAppState(normalized))
      .catch((error) => console.error("[db] Supabase state persist failed:", error.message));
  }
}

async function initAppStateStore() {
  const localDb = readDb();
  appDbCache = localDb;
  if (!USE_SUPABASE_DB) return;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when APP_DB_PROVIDER=supabase.");
  }

  const { default: pool } = await import("./database/pool.js");
  appDbPool = pool;
  await appDbPool.query(`
    CREATE TABLE IF NOT EXISTS ${APP_STATE_TABLE_SQL} (
      id text PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const result = await appDbPool.query(`SELECT data FROM ${APP_STATE_TABLE_SQL} WHERE id = $1`, [APP_STATE_KEY]);
  if (result.rows[0]?.data) {
    appDbCache = ensureBetaCollections(result.rows[0].data);
    writeFileSync(DB_FILE, `${JSON.stringify(appDbCache, null, 2)}\n`);
    return;
  }
  await persistAppState(localDb);
}

async function persistAppState(db) {
  if (!appDbPool) return;
  await appDbPool.query(
    `INSERT INTO ${APP_STATE_TABLE_SQL} (id, data, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
    [APP_STATE_KEY, JSON.stringify(ensureBetaCollections(db))]
  );
}

function id(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// CORS + security headers are applied once per request in handleRequest (via
// applySecurityHeaders below) rather than duplicated on every json(...) call site.
function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function applySecurityHeaders(req, res) {
  const allowedOrigin = resolveAllowedOrigin(req);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
}

// ── Rate limiting ────────────────────────────────────────────────────────
// Simple in-memory sliding-window limiter per client IP. This is a single-process
// app (no shared cache/Redis available), so an in-memory map is the pragmatic choice;
// if this is ever deployed behind multiple instances, swap this for a shared store.
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 240); // general API traffic
const AUTH_RATE_LIMIT_MAX = Number(process.env.AUTH_RATE_LIMIT_MAX || 20); // login/auth is far more brute-forceable
const rateLimitBuckets = new Map();

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "unknown";
}

function checkRateLimit(key, max) {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key) || [];
  const recent = bucket.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitBuckets.set(key, recent);
  return recent.length <= max;
}

// Periodically drop empty/stale buckets so this map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitBuckets) {
    if (!bucket.some((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)) rateLimitBuckets.delete(key);
  }
}, RATE_LIMIT_WINDOW_MS).unref?.();

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolveBody(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readRaw(req, limit = MAX_UPLOAD_BYTES + 1024 * 1024) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Upload is too large. Maximum resume size is 10MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function normalize(text) {
  return String(text || "").toLowerCase();
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractEmail(text) {
  return String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
}

function candidateEmail(candidate) {
  return candidate.email || extractEmail(candidate.resumeText) || extractEmail(candidate.aiSummary);
}

function extractDates(text) {
  const value = String(text || "");
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/g) || [];
  const slash = value.match(/\b(\d{1,2}\/\d{1,2}\/20\d{2})\b/g) || [];
  return [...iso, ...slash].slice(0, 2);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Builds a regex that matches `skill` as a whole token: a real word boundary on each side,
// where "boundary" means "not a letter or digit" (so punctuation-bearing skills like "C++",
// "Node.js", "CI/CD", and "UI/UX" still match correctly, but "C" won't match inside "Contact"
// and "AI" won't match inside "gmail.com" or "detail").
function skillPattern(skill) {
  const escaped = escapeRegExp(skill);
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
}
const SKILL_PATTERNS = new Map(KNOWN_SKILLS.map((skill) => [skill, skillPattern(skill)]));

// Phrases where a known skill term appears as plain English / a proper noun / part of an
// unrelated compound phrase rather than as an actual claimed skill. Checked case-insensitively;
// if any of these phrases is what matched, that skill hit is dropped as a false positive.
const SKILL_FALSE_POSITIVE_CONTEXT = {
  AWS: [/\baws academy\b/i],
  Healthcare: [/\brural healthcare\b/i, /\bhealthcare (?:solution|platform|sector|industry)\b/i],
  AI: [/\bai voice assistant\b/i],
  Security: [/\bsocial security\b/i, /\bjob security\b/i],
  ML: []
};

function isSkillFalsePositive(skill, normalizedText) {
  const guards = SKILL_FALSE_POSITIVE_CONTEXT[skill];
  if (!guards || !guards.length) return false;
  return guards.some((guard) => guard.test(normalizedText));
}

function extractSkills(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  return KNOWN_SKILLS.filter((skill) => {
    if (!SKILL_PATTERNS.get(skill).test(normalized)) return false;
    return !isSkillFalsePositive(skill, normalized);
  });
}

// Keeps an AI-suggested skill ONLY if it is also a real, literal, word-bounded match in the
// resume text (using the same matcher as the keyword scanner, plus a free-text fallback for
// skills the AI named that aren't in our fixed KNOWN_SKILLS list at all, e.g. "Vue.js", "C#").
// This is what stops Cohere from hallucinating skills like "SQL" or "REST" purely from project
// context (e.g. inferring SQL because a project mentions a database) when the word itself never
// appears in the resume.
function verifyAiSkillAgainstText(skill, normalizedText) {
  const trimmed = String(skill || "").trim();
  if (!trimmed) return false;
  const known = KNOWN_SKILLS.find((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  if (known) return SKILL_PATTERNS.get(known).test(normalizedText) && !isSkillFalsePositive(known, normalizedText);
  // Not one of our known terms (e.g. "Vue.js", "C#", "Salesforce") — still require a literal,
  // whole-word-ish match in the resume so the AI can't invent skills out of thin air.
  const escaped = escapeRegExp(trimmed);
  const adHocPattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return adHocPattern.test(normalizedText);
}

function extractJobFromText(text, source = "text") {
  const cleaned = cleanExtractedText(text);
  const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const titleLine = lines.find((line) => /engineer|developer|analyst|designer|manager|consultant|architect|specialist|administrator|lead/i.test(line)) || lines[0] || "Untitled Job";
  const dates = extractDates(cleaned);
  const clearance = /baseline/i.test(cleaned) ? "Baseline" : /clearance|security cleared/i.test(cleaned) ? "Clearance" : "No clearance";
  return {
    title: titleLine.replace(/^job title[:\s-]*/i, "").slice(0, 90),
    department: /data|analytics/i.test(cleaned) ? "Data" : /cloud|devops/i.test(cleaned) ? "Cloud" : /ai|machine learning|\bml\b/i.test(cleaned) ? "AI/ML" : "Technology",
    location: lines.find((line) => /remote|hybrid|melbourne|sydney|brisbane|perth|adelaide|canberra|australia|india/i.test(line)) || "Location not set",
    employmentType: /contract/i.test(cleaned) ? "Contract" : /part time/i.test(cleaned) ? "Part time" : "Full time",
    status: "open",
    priority: /urgent|immediate|asap|critical|high priority/i.test(cleaned) ? "High" : "Medium",
    clearance,
    startDate: dates[0] || "",
    closingDate: dates[1] || "",
    skills: extractSkills(cleaned),
    description: cleaned.slice(0, 3500),
    source
  };
}

function jobImportToFormJob(imported) {
  const text = `${imported.description || ""} ${(imported.skills || []).join(" ")}`;
  const dates = extractDates(text);
  return {
    title: imported.title || "Untitled Job",
    organization: imported.organization || "",
    department: imported.organization || (/data|analytics/i.test(text) ? "Data" : /cloud|devops/i.test(text) ? "Cloud" : /ai|machine learning|\bml\b/i.test(text) ? "AI/ML" : "Technology"),
    location: imported.location || "Location not set",
    employmentType: imported.employmentType || (/contract/i.test(text) ? "Contract" : /part time/i.test(text) ? "Part time" : "Full time"),
    status: "open",
    priority: /urgent|immediate|asap|critical|high priority/i.test(text) ? "High" : "Medium",
    clearance: /baseline/i.test(text) ? "Baseline" : /clearance|security cleared/i.test(text) ? "Clearance" : "No clearance",
    startDate: "",
    closingDate: imported.closingDate || dates[1] || dates[0] || "",
    skills: imported.skills || extractSkills(text),
    description: imported.description || "",
    contractValue: imported.contractValue || "",
    sourceUrl: imported.sourceUrl || ""
  };
}

function stripHtmlToText(html) {
  return cleanExtractedText(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'"));
}

async function fetchUrlText(targetUrl) {
  const parsed = new URL(targetUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS job URLs are supported.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.JOB_URL_TIMEOUT_MS || 12000));
  const response = await fetch(parsed, {
    signal: controller.signal,
    headers: {
      "User-Agent": "ASJ-ATS-Beta/1.0 (+job-extractor)",
      Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8"
    }
  }).finally(() => clearTimeout(timer));
  if (!response.ok) throw new Error(`Job URL returned ${response.status}`);
  const contentType = response.headers.get("content-type") || "";
  const raw = await response.text();
  if (contentType.includes("application/json")) {
    try {
      return cleanExtractedText(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      return cleanExtractedText(raw);
    }
  }
  return stripHtmlToText(raw);
}

function roleCategoryFromText(text, skills = []) {
  const lower = normalize(`${text} ${skills.join(" ")}`);
  const scored = ROLE_KEYWORDS.map((role) => ({
    ...role,
    score: role.terms.filter((term) => lower.includes(term)).length
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.score ? scored[0] : { category: "General ICT", title: "ICT Candidate", score: 0 };
}

function seniorityFromYears(years) {
  if (years >= 8) return "Lead";
  if (years >= 5) return "Senior";
  if (years >= 2) return "Mid-level";
  return "Emerging";
}

function parseJsonObject(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced || trimmed;
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("AI did not return JSON.");
  return JSON.parse(source.slice(start, end + 1));
}

function parseMultipart(buffer, contentType) {
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.[2];
  if (!boundary) throw new Error("Invalid upload request.");

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter);

  while (start !== -1) {
    start += delimiter.length;
    if (buffer.slice(start, start + 2).toString() === "--") break;
    if (buffer.slice(start, start + 2).toString() === "\r\n") start += 2;

    const next = buffer.indexOf(delimiter, start);
    if (next === -1) break;

    let part = buffer.slice(start, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const rawHeaders = part.slice(0, headerEnd).toString("utf8");
      const body = part.slice(headerEnd + 4);
      const disposition = rawHeaders.match(/content-disposition:[^\r\n]+/i)?.[0] || "";
      const name = disposition.match(/name="([^"]+)"/)?.[1] || "";
      const filename = disposition.match(/filename="([^"]*)"/)?.[1] || "";
      const contentTypeHeader = rawHeaders.match(/content-type:\s*([^\r\n]+)/i)?.[1] || "application/octet-stream";
      parts.push({ name, filename, contentType: contentTypeHeader, body });
    }

    start = next;
  }

  return parts;
}

function safeFilename(filename) {
  const cleaned = filename.replace(/[^a-z0-9_.-]/gi, "_").replace(/_+/g, "_");
  return cleaned || `resume_${Date.now()}`;
}

function fileSha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function assertAllowedUpload({ buffer, filename, allowedExtensions = ALLOWED_RESUME_EXTENSIONS, label = "file" }) {
  const extension = extname(filename).toLowerCase();
  if (!allowedExtensions.has(extension)) {
    throw new Error(`Unsupported ${label} type.`);
  }
  const signature = buffer.subarray(0, 12).toString("hex");
  const asciiStart = buffer.subarray(0, 64).toString("latin1");
  const isPdf = extension === ".pdf" && asciiStart.startsWith("%PDF-");
  const isZipDocx = extension === ".docx" && signature.startsWith("504b0304");
  const isLegacyDoc = extension === ".doc" && signature.startsWith("d0cf11e0a1b11ae1");
  const isPng = extension === ".png" && signature.startsWith("89504e470d0a1a0a");
  const isJpeg = [".jpg", ".jpeg"].includes(extension) && signature.startsWith("ffd8ff");
  const isGif = extension === ".gif" && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("latin1"));
  const isWebp = extension === ".webp" && buffer.subarray(0, 4).toString("latin1") === "RIFF" && buffer.subarray(8, 12).toString("latin1") === "WEBP";
  const isTiff = [".tif", ".tiff"].includes(extension) && (signature.startsWith("49492a00") || signature.startsWith("4d4d002a"));
  if (!(isPdf || isZipDocx || isLegacyDoc || isPng || isJpeg || isGif || isWebp || isTiff)) {
    throw new Error(`The uploaded ${label} content does not match its file extension.`);
  }
  return extension;
}

async function uploadObject(buffer, filename, contentType = "application/octet-stream") {
  const storedName = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${safeFilename(filename)}`;
  if (!USE_SUPABASE_STORAGE) {
    const storedPath = join(UPLOAD_DIR, storedName);
    writeFileSync(storedPath, buffer, { mode: 0o600 });
    return { url: `/uploads/${storedName}`, storageKey: storedName };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase Storage is enabled but SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
  }
  const storageKey = `uploads/${storedName}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodeURIComponent(storageKey).replace(/%2F/g, "/")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=0, no-store",
      "x-upsert": "false"
    },
    body: buffer
  });
  if (!response.ok) {
    throw new Error(`Supabase Storage upload failed with HTTP ${response.status}.`);
  }
  return { url: `/uploads/${storedName}`, storageKey };
}

async function readStoredObject(uploadName) {
  if (!USE_SUPABASE_STORAGE) {
    const file = resolve(UPLOAD_DIR, uploadName);
    if (!file.startsWith(UPLOAD_DIR) || !existsSync(file)) return null;
    return { body: readFileSync(file), contentType: contentTypeForFile(file), fileName: basename(file) };
  }
  const storageKey = `uploads/${uploadName}`;
  const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${SUPABASE_STORAGE_BUCKET}/${encodeURIComponent(storageKey).replace(/%2F/g, "/")}`, {
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!response.ok) return null;
  return {
    body: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get("content-type") || contentTypeForFile(uploadName),
    fileName: uploadName
  };
}

function cleanExtractedText(text) {
  return String(text || "")
    .replace(/\0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReadableText(buffer, encoding = "latin1") {
  const text = buffer.toString(encoding)
    .replace(/[^\x09\x0A\x0D\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 30 ? text : "";
}

function decodeXmlEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

function readZipEntries(buffer) {
  const entries = new Map();

  for (let end = buffer.length - 22; end >= Math.max(0, buffer.length - 66000); end -= 1) {
    if (buffer.readUInt32LE(end) !== 0x06054b50) continue;

    const entryCount = buffer.readUInt16LE(end + 10);
    let offset = buffer.readUInt32LE(end + 16);

    for (let entryIndex = 0; entryIndex < entryCount && offset < buffer.length - 46; entryIndex += 1) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) break;

      const method = buffer.readUInt16LE(offset + 10);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const nameLength = buffer.readUInt16LE(offset + 28);
      const extraLength = buffer.readUInt16LE(offset + 30);
      const commentLength = buffer.readUInt16LE(offset + 32);
      const localOffset = buffer.readUInt32LE(offset + 42);
      const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString("utf8");

      if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
        const localNameLength = buffer.readUInt16LE(localOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.slice(dataStart, dataStart + compressedSize);
        try {
          if (method === 0) entries.set(name, compressed);
          if (method === 8) entries.set(name, inflateRawSync(compressed));
        } catch {
          // Skip damaged entries and continue parsing the rest of the document.
        }
      }

      offset += 46 + nameLength + extraLength + commentLength;
    }

    if (entries.size) return entries;
  }

  let offset = 0;

  while (offset < buffer.length - 30) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.slice(nameStart, nameStart + nameLength).toString("utf8");

    if (!compressedSize && !uncompressedSize) break;

    const compressed = buffer.slice(dataStart, dataStart + compressedSize);
    try {
      if (method === 0) entries.set(name, compressed);
      if (method === 8) entries.set(name, inflateRawSync(compressed));
    } catch {
      // Skip damaged entries and continue parsing the rest of the document.
    }

    offset = dataStart + compressedSize;
  }

  return entries;
}

function extractDocxText(buffer) {
  const entries = readZipEntries(buffer);
  const xmlFiles = [...entries.entries()]
    .filter(([name]) => /^word\/(document|header\d+|footer\d+)\.xml$/.test(name))
    .map(([, content]) => content.toString("utf8"));

  const text = xmlFiles.join("\n")
    .replace(/<w:tab\/>/g, " ")
    .replace(/<w:br\/>|<\/w:p>|<\/w:tr>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .split(/\n+/)
    .map((line) => decodeXmlEntities(line).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return cleanExtractedText(text);
}

function decodePdfLiteral(value) {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, char) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[char] || char)
    .replace(/\\([0-7]{1,3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function decodePdfHex(value) {
  const normalized = value.replace(/\s+/g, "");
  const bytes = [];
  for (let index = 0; index < normalized.length - 1; index += 2) {
    bytes.push(parseInt(normalized.slice(index, index + 2), 16));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = "";
    for (let index = 2; index < bytes.length - 1; index += 2) {
      text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1]);
    }
    return text;
  }
  return Buffer.from(bytes).toString("latin1");
}

function extractPdfOperatorsText(content) {
  const fragments = [];
  const literal = /\((?:\\.|[^\\)])*\)\s*Tj/g;
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  const arrays = /\[((?:.|\n)*?)\]\s*TJ/g;
  let match;

  while ((match = literal.exec(content))) {
    fragments.push(decodePdfLiteral(match[0].slice(1, match[0].lastIndexOf(")"))));
  }
  while ((match = hex.exec(content))) {
    fragments.push(decodePdfHex(match[1]));
  }
  while ((match = arrays.exec(content))) {
    const array = match[1];
    for (const part of array.matchAll(/\((?:\\.|[^\\)])*\)|<([0-9A-Fa-f\s]+)>/g)) {
      fragments.push(part[0].startsWith("(") ? decodePdfLiteral(part[0].slice(1, -1)) : decodePdfHex(part[1]));
    }
    fragments.push("\n");
  }

  return fragments.join(" ");
}

function extractPdfText(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = [raw];
  const streamPattern = /<<(?:.|\n|\r)*?>>\s*stream\r?\n?([\s\S]*?)\r?\n?endstream/g;
  let match;

  while ((match = streamPattern.exec(raw))) {
    const stream = Buffer.from(match[1], "latin1");
    const dictionary = match[0].slice(0, match[0].indexOf("stream"));
    if (!/FlateDecode/i.test(dictionary)) continue;

    try {
      chunks.push(inflateSync(stream).toString("latin1"));
    } catch {
      try {
        chunks.push(inflateRawSync(stream).toString("latin1"));
      } catch {
        // Leave this stream out if the PDF object is compressed in an unsupported way.
      }
    }
  }

  const operatorText = chunks.map(extractPdfOperatorsText).join("\n");
  const fallback = extractReadableText(buffer);
  return cleanExtractedText(operatorText.length > 30 ? operatorText : fallback);
}

function runTextCommand(command, args) {
  try {
    return cleanExtractedText(execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20000
    }));
  } catch {
    return "";
  }
}

function hasPdfHeader(filePath) {
  try {
    return readFileSync(filePath).subarray(0, 5).toString("latin1") === "%PDF-";
  } catch {
    return false;
  }
}

function extractWithLocalTools(filePath, extension) {
  if (!filePath || !existsSync(filePath)) return { text: "", parser: "" };

  if (IMAGE_RESUME_EXTENSIONS.has(extension)) {
    const text = runTextCommand("/opt/homebrew/bin/tesseract", [filePath, "stdout"])
      || runTextCommand("/usr/local/bin/tesseract", [filePath, "stdout"]);
    return { text, parser: text ? "tesseract-ocr" : "" };
  }

  if (extension === ".pdf") {
    if (!hasPdfHeader(filePath)) return { text: "", parser: "" };
    const text = runTextCommand("/opt/homebrew/bin/pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"])
      || runTextCommand("/usr/local/bin/pdftotext", ["-layout", "-enc", "UTF-8", filePath, "-"])
      || runTextCommand("/usr/bin/mdls", ["-raw", "-name", "kMDItemTextContent", filePath]);
    return { text, parser: text ? "pdftotext" : "" };
  }

  if (extension === ".doc" || extension === ".docx") {
    const text = runTextCommand("/usr/bin/textutil", ["-convert", "txt", "-stdout", filePath])
      || runTextCommand("/usr/bin/mdls", ["-raw", "-name", "kMDItemTextContent", filePath]);
    return { text, parser: text ? "textutil" : "" };
  }

  return { text: "", parser: "" };
}

function scoreExtractionQuality(text) {
  const cleaned = cleanExtractedText(text);
  const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
  const readableRatio = cleaned.length ? letters / cleaned.length : 0;
  const hasContactSignal = /@|phone|mobile|\+\d|experience|skills|education|projects|summary/i.test(cleaned);

  if (cleaned.length >= 200 && readableRatio > 0.35 && hasContactSignal) return "good";
  if (cleaned.length >= 60 && readableRatio > 0.25) return "partial";
  return "poor";
}

function extractResumeText(buffer, filename, filePath = "") {
  const extension = extname(filename).toLowerCase();
  const local = extractWithLocalTools(filePath, extension);
  let text = local.text;
  let parser = local.parser;

  if (!text && extension === ".docx") {
    text = extractDocxText(buffer);
    parser = "docx-xml";
  }
  if (!text && extension === ".pdf") {
    text = extractPdfText(buffer);
    parser = "pdf-stream";
  }
  if (!text && extension === ".doc") {
    text = extractReadableText(buffer, "utf16le") || extractReadableText(buffer);
    parser = "legacy-doc-text";
  }

  text = cleanExtractedText(text || extractReadableText(buffer));

  return {
    text,
    parser: parser || (extension === ".docx" ? "docx-xml" : extension === ".pdf" ? "pdf-stream" : IMAGE_RESUME_EXTENSIONS.has(extension) ? "image-awaiting-ocr" : "legacy-doc-text"),
    quality: scoreExtractionQuality(text)
  };
}

function findResumeFiles(folder, files = []) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const fullPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      findResumeFiles(fullPath, files);
      continue;
    }

    if (entry.isFile() && ALLOWED_RESUME_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function addResumeToInbox(db, { buffer, filename, jobId, source, sourcePath = "", contentType = "" }) {
  const extension = assertAllowedUpload({ buffer, filename, label: "resume" });
  const stored = await uploadObject(buffer, filename, contentType || contentTypeForExtension(extension));

  const resume = {
    id: id("wr"),
    submittedAt: new Date().toISOString(),
    source,
    sourcePath,
    jobId: jobId || "",
    processed: false,
    resumeUrl: stored.url,
    storageProvider: USE_SUPABASE_STORAGE ? "supabase" : "local",
    storageKey: stored.storageKey,
    checksumSha256: fileSha256(buffer),
    fileName: filename,
    fileType: extension.slice(1).toUpperCase(),
    fileSize: buffer.length,
    parser: "queued",
    extractionQuality: "queued",
    queueStatus: "Uploaded",
    resumeText: "",
    queueMessage: "Uploaded successfully. Processing in background."
  };

  db.websiteResumes.push(resume);
  return resume;
}

function publicState(db) {
  return {
    data: hydrate(db),
    dashboard: dashboard(db),
    recommendations: talentRecommendations(db)
  };
}

// ── Compliance ───────────────────────────────────────────────────────────
const COMPLIANCE_DOCUMENT_TYPES = ["Passport", "Visa", "Work Authorization", "Security Clearance", "Police Verification", "Certification", "Other"];
const COMPLIANCE_EXPIRY_WARNING_DAYS = 30;
const ALLOWED_COMPLIANCE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp"]);

// A document counts as "expired" the moment its expiry date passes, regardless of what
// status it was last set to -- this is computed live rather than stored, so a document
// verified 11 months ago against a 1-year visa correctly flips to expired on its own
// without needing a background job to go update it.
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
  return daysLeft >= 0 && daysLeft <= COMPLIANCE_EXPIRY_WARNING_DAYS;
}

// Rolls a candidate's documents up into one overall status for the compliance dashboard:
// no documents at all -> missing; any expired -> expired (worst case wins); any flagged
// for manual review -> review_required; all verified -> verified; otherwise -> pending
// (submitted but nothing's been checked yet).
function candidateComplianceStatus(candidate) {
  const docs = candidate.complianceDocuments || [];
  if (!docs.length) return "missing";
  const statuses = docs.map(documentEffectiveStatus);
  if (statuses.includes("expired")) return "expired";
  if (statuses.includes("review_required")) return "review_required";
  if (statuses.every((status) => status === "verified")) return "verified";
  return "pending";
}

function candidateHasExpiringDocument(candidate) {
  return (candidate.complianceDocuments || []).some(documentIsExpiringSoon);
}

function complianceSummary(db) {
  const summary = { verified: 0, pending: 0, missing: 0, expired: 0, expiringSoon: 0 };
  for (const candidate of db.candidates) {
    const status = candidateComplianceStatus(candidate);
    if (status === "verified") summary.verified += 1;
    else if (status === "expired") summary.expired += 1;
    else if (status === "missing") summary.missing += 1;
    else summary.pending += 1; // pending + review_required both count as "needs attention"
    if (candidateHasExpiringDocument(candidate)) summary.expiringSoon += 1;
  }
  return summary;
}

function findComplianceDocument(db, documentId) {
  for (const candidate of db.candidates) {
    const doc = (candidate.complianceDocuments || []).find((item) => item.id === documentId);
    if (doc) return { candidate, doc };
  }
  return null;
}

function resumeDiskPath(resume) {
  if (resume.sourcePath && existsSync(resume.sourcePath)) return resume.sourcePath;
  if (resume.resumeUrl?.startsWith("/uploads/")) {
    const file = resolve(UPLOAD_DIR, resume.resumeUrl.replace("/uploads/", ""));
    if (file.startsWith(UPLOAD_DIR) && existsSync(file)) return file;
  }
  return "";
}

function updateCandidateFromResume(db, resume) {
  if (!resume.candidateId || resume.extractionQuality === "poor") return false;

  const candidate = db.candidates.find((item) => item.id === resume.candidateId);
  if (!candidate) return false;

  const parsed = parseResume(resume.resumeText, resume.source, resume.resumeUrl);
  Object.assign(candidate, {
    name: parsed.name,
    email: parsed.email,
    phone: parsed.phone,
    location: parsed.location,
    currentRole: parsed.currentRole,
    roleCategory: parsed.roleCategory,
    seniority: parsed.seniority,
    experienceYears: parsed.experienceYears,
    skills: parsed.skills,
    tags: parsed.tags,
    eligibleRoles: parsed.eligibleRoles,
    resumeText: parsed.resumeText,
    aiSummary: parsed.aiSummary,
    marketFit: parsed.marketFit,
    parseConfidence: parsed.parseConfidence,
    parsedBy: parsed.parsedBy
  });
  refreshAtsReport(db, candidate);
  return true;
}

function reparseStoredResumes(db) {
  const reparsed = [];
  const failed = [];

  for (const resume of db.websiteResumes.filter((item) => item.fileName || item.sourcePath || item.resumeUrl?.startsWith("/uploads/"))) {
    const filePath = resumeDiskPath(resume);
    if (!filePath) {
      failed.push({ id: resume.id, fileName: resume.fileName || resume.resumeUrl, error: "Stored file was not found." });
      continue;
    }

    try {
      const parsed = extractResumeText(readFileSync(filePath), resume.fileName || basename(filePath), filePath);
      resume.resumeText = parsed.text || resume.resumeText;
      resume.parser = parsed.parser;
      resume.extractionQuality = parsed.quality;
      resume.needsReview = parsed.quality === "poor";
      resume.reparsedAt = new Date().toISOString();
      updateCandidateFromResume(db, resume);
      reparsed.push({ id: resume.id, fileName: resume.fileName || basename(filePath), quality: parsed.quality });
    } catch (error) {
      failed.push({ id: resume.id, fileName: resume.fileName || basename(filePath), error: error.message });
    }
  }

  db.activities.push({
    id: id("act"),
    message: `${reparsed.length} stored resume${reparsed.length === 1 ? "" : "s"} re-read from uploaded files. ${failed.length} failed.`,
    createdAt: new Date().toISOString()
  });

  return { reparsed, failed };
}

async function handleResumeUpload(req, db) {
  const body = await readRaw(req);
  const parts = parseMultipart(body, req.headers["content-type"] || "");
  const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.body.toString("utf8")]));
  const file = parts.find((part) => part.name === "resume" && part.filename);

  if (!file) throw new Error("Choose a resume file to upload.");
  if (file.body.length > MAX_UPLOAD_BYTES) throw new Error("Resume is too large. Maximum resume size is 10MB.");

  const extension = extname(file.filename).toLowerCase();
  if (!ALLOWED_RESUME_EXTENSIONS.has(extension)) {
    throw new Error("Only PDF, DOC, DOCX, PNG, JPG, WEBP, and TIFF resumes are allowed.");
  }

  const resume = await addResumeToInbox(db, {
    buffer: file.body,
    filename: file.filename,
    jobId: fields.jobId,
    source: "Manual Resume Upload",
    contentType: file.contentType
  });

  if (fields.resumeText?.trim()) {
    resume.resumeText = cleanExtractedText(fields.resumeText);
    resume.parser = "manual-text";
    resume.extractionQuality = "good";
  }
  resume.duplicateAction = fields.duplicateAction === "rename" ? "rename" : "skip";

  db.activities.push({
    id: id("act"),
    message: `${file.filename} uploaded into Resume Inbox.`,
    createdAt: new Date().toISOString()
  });

  return resume;
}

async function handleBulkResumeUpload(req, db) {
  const body = await readRaw(req, MAX_BULK_UPLOAD_BYTES);
  const parts = parseMultipart(body, req.headers["content-type"] || "");
  const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.body.toString("utf8")]));
  const files = parts.filter((part) => part.name === "resume" && part.filename);
  if (!files.length) throw new Error("Choose one or more resume files to upload.");
  if (files.length > MAX_BULK_RESUMES) throw new Error(`Upload at most ${MAX_BULK_RESUMES} resumes at a time.`);

  const imported = [];
  const failed = [];
  for (const file of files) {
    try {
      if (file.body.length > MAX_UPLOAD_BYTES) throw new Error("Resume is too large. Maximum resume size is 10MB.");
      const resume = await addResumeToInbox(db, {
        buffer: file.body,
        filename: file.filename,
        jobId: "",
        source: files.length > 1 ? "Bulk Resume Upload" : "Manual Resume Upload",
        contentType: file.contentType
      });
      resume.duplicateAction = fields.duplicateAction === "rename" ? "rename" : "skip";
      if (files.length === 1 && fields.resumeText?.trim()) {
        resume.resumeText = cleanExtractedText(fields.resumeText);
        resume.parser = "manual-text";
        resume.extractionQuality = "good";
      }
      imported.push(resume);
    } catch (error) {
      failed.push({ fileName: file.filename, error: error.message });
    }
  }

  db.activities.push({
    id: id("act"),
    message: `${imported.length} resume${imported.length === 1 ? "" : "s"} uploaded into Resume Inbox. ${failed.length} failed.`,
    createdAt: new Date().toISOString()
  });
  return { imported, failed };
}

function normalizeCandidateProfile(profile, resumeText, source, resumeUrl) {
  const text = String(resumeText || "").replace(/\s+/g, " ").trim();
  const verifiedAiSkills = (profile.skills || []).filter((skill) => verifyAiSkillAgainstText(skill, text));
  const skills = uniq([...verifiedAiSkills, ...extractSkills(text)]).slice(0, 18);
  const years = Number(profile.experienceYears || 0);
  const role = profile.currentRole || roleCategoryFromText(text, skills).title;
  const roleInfo = roleCategoryFromText(`${role} ${text}`, skills);
  const name = profile.name || "Unnamed Candidate";

  return {
    id: id("c"),
    name,
    email: profile.email || "",
    phone: profile.phone || "",
    location: profile.location || "",
    currentRole: role,
    roleCategory: profile.roleCategory || roleInfo.category,
    seniority: profile.seniority || seniorityFromYears(years),
    experienceYears: years,
    source,
    status: "active",
    skills,
    tags: uniq(["AI Parsed", profile.seniority || seniorityFromYears(years), profile.roleCategory || roleInfo.category, ...(profile.tags || [])]),
    eligibleRoles: uniq(profile.eligibleRoles || [roleInfo.title]),
    resumeUrl,
    resumeText: text,
    aiSummary: profile.aiSummary || buildCandidateSummary({ name, currentRole: role, years, skills, location: profile.location }),
    marketFit: profile.marketFit || "Profile parsed and ready for recruiter review.",
    parseConfidence: Number(profile.parseConfidence || 70),
    parsedBy: profile.parsedBy || "local-parser",
    createdAt: new Date().toISOString()
  };
}

function candidateFingerprint(candidate) {
  const skills = (candidate.skills || []).map((skill) => skill.toLowerCase()).sort().join("|");
  const text = normalize(candidate.resumeText || "").replace(/\s+/g, " ").slice(0, 1200);
  return `${skills}::${text}`;
}

function nextDuplicateName(db, baseName) {
  const clean = String(baseName || "Candidate").replace(/\s+\d+$/, "");
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^${escaped}(?:\\s+(\\d+))?$`, "i");
  const used = db.candidates
    .map((candidate) => String(candidate.name || "").match(pattern)?.[1])
    .map((value) => Number(value || 0));
  let index = 1;
  while (used.includes(index)) index += 1;
  return `${clean} ${index}`;
}

function parseResume(resumeText, source = "ASJ Website", resumeUrl = "") {
  const text = String(resumeText || "").replace(/\s+/g, " ").trim();
  const email = extractEmail(text);
  const phone = text.match(/(?:\+?\d[\d\s().–-]{7,}\d)/)?.[0]?.trim() || "";
  const years = Number(text.match(/(\d{1,2})\s*(?:\+?\s*)?(?:years?|yrs?)/i)?.[1] || 0);
  const beforeEmail = email ? text.slice(0, text.indexOf(email)).trim() : text;
  const lines = String(resumeText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const firstUsefulLine = lines.find((line) => !/@|phone|mobile|ph:|\+?\d{7}/i.test(line)) || beforeEmail;
  const name = firstUsefulLine.split(/\s+/).slice(0, 3).join(" ") || "Unnamed Candidate";
  const skills = extractSkills(text);
  const roleInfo = roleCategoryFromText(text, skills);
  const location = ["Melbourne", "Sydney", "Brisbane", "Canberra", "Perth", "Adelaide", "Bengaluru", "Bangalore", "Kochi", "India"].find((city) =>
    normalize(text).includes(city.toLowerCase())
  ) || "";

  return normalizeCandidateProfile({
    name,
    email,
    phone,
    location,
    currentRole: roleInfo.title,
    roleCategory: roleInfo.category,
    seniority: seniorityFromYears(years),
    experienceYears: years,
    skills,
    eligibleRoles: [roleInfo.title],
    parseConfidence: email ? 75 : 55
  }, text, source, resumeUrl);
}

function buildCandidateSummary(candidate) {
  const skills = candidate.skills?.length ? candidate.skills.slice(0, 6).join(", ") : "general ICT skills";
  const exp = candidate.experienceYears || candidate.years || 0;
  return `${candidate.name} is a ${candidate.currentRole || "candidate"} with ${exp || "relevant"} years of experience across ${skills}${candidate.location ? ` in ${candidate.location}` : ""}.`;
}

async function callCohereText(messages, maxTokens = 700) {
  if (!process.env.COHERE_API_KEY) return "";

  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.COHERE_MODEL || "command-a-03-2025",
      max_tokens: maxTokens,
      messages
    })
  });

  if (!response.ok) throw new Error(await response.text());
  const result = await response.json();
  return result.message?.content?.map((part) => part.text).filter(Boolean).join("\n") || "";
}

async function parseResumeWithAi(resume, db) {
  const localProfile = parseResume(resume.resumeText, resume.source, resume.resumeUrl);
  if (!process.env.COHERE_API_KEY || resume.extractionQuality === "poor") return localProfile;

  const jobsContext = db.jobs.filter((job) => job.status === "open").map((job) => ({
    id: job.id,
    title: job.title,
    skills: job.skills,
    description: job.description,
    location: job.location
  }));

  try {
    const text = await callCohereText([
      {
        role: "system",
        content: "You are an expert ATS resume parser for ASJ recruitment. Return only valid JSON with no markdown."
      },
      {
        role: "user",
        content: `Parse this resume into a structured ATS candidate profile. Infer practical role category, seniority, eligible roles, market fit, and concise summary. Do not invent contact details. Use the open jobs only for matching hints, not as facts. For "skills": only list a skill if it is literally named in the resume text (a tool, language, framework, or platform written by name) -- never infer a skill just because a project description implies it (e.g. do not add "SQL" just because a project mentions a database, and do not add "REST" just because a project mentions an API).\n\nOpen jobs:\n${JSON.stringify(jobsContext)}\n\nResume text:\n${resume.resumeText.slice(0, 12000)}\n\nReturn this JSON shape exactly:\n{"name":"","email":"","phone":"","location":"","currentRole":"","roleCategory":"","seniority":"","experienceYears":0,"skills":[],"tags":[],"eligibleRoles":[],"aiSummary":"","marketFit":"","parseConfidence":0}`
      }
    ], 900);

    const profile = parseJsonObject(text);
    return normalizeCandidateProfile({ ...profile, parsedBy: "cohere" }, resume.resumeText, resume.source, resume.resumeUrl);
  } catch {
    return localProfile;
  }
}

// scoreMatch() used to contain the entire matching formula inline (flat skill-string
// comparison, years/8 experience bonus, and a couple of flat role-keyword bonuses -- see
// git history if you need to compare). It's now a thin synchronous wrapper around the
// modular scoring engine in ./matching/, which every existing call site below keeps
// using exactly as before since the return shape (matchScore/matchedSkills/skillGaps/
// recommendation) is unchanged -- it just now also carries a `breakdown` field with the
// full explainable score. This sync path never calls the semantic-similarity API (that
// would mean a network round-trip for every candidate x job pair in every dashboard
// load) -- see GET /api/candidates/:candidateId/match/:jobId below for the full version
// with real semantic matching included, computed on demand for one pair at a time.
function scoreMatch(candidate, job, db) {
  return matchCandidateToJobSync(candidate, job, db ? matchWeightsFromSettings(db) : undefined);
}

function refreshJobApplications(db, job) {
  for (const candidate of db.candidates.filter((item) => item.status === "active")) {
    const match = scoreMatch(candidate, job, db);
    const existing = db.applications.find((app) => app.candidateId === candidate.id && app.jobId === job.id);
    if (existing) {
      existing.matchScore = match.matchScore;
      existing.skillGaps = match.skillGaps;
      existing.matchedSkills = match.matchedSkills;
      existing.recommendation = match.recommendation;
      existing.notes = `AI match: ${match.recommendation}.`;
      existing.updatedAt = new Date().toISOString();
      continue;
    }
    if (match.matchScore < 60 || job.status !== "open") continue;
    db.applications.push({
      id: id("a"),
      candidateId: candidate.id,
      jobId: job.id,
      stage: match.matchScore >= 85 ? "Matched Candidates" : "Applied",
      matchScore: match.matchScore,
      skillGaps: match.skillGaps,
      matchedSkills: match.matchedSkills,
      recommendation: match.recommendation,
      notes: `AI match: ${match.recommendation}.`,
      appliedAt: new Date().toISOString()
    });
  }
}

function normalizeStage(stage) {
  return STAGE_ALIASES[stage] || (STAGES.includes(stage) ? stage : "Applied");
}

function hydrate(db) {
  const clientsById = Object.fromEntries(db.clients.map((client) => [client.id, client]));
  const jobsById = Object.fromEntries(db.jobs.map((job) => [job.id, { ...job, client: clientsById[job.clientId]?.company || "Unknown" }]));
  const candidatesById = Object.fromEntries(db.candidates.map((candidate) => [candidate.id, candidate]));
  const applications = db.applications.map((app) => ({
    ...app,
    stage: normalizeStage(app.stage),
    candidate: candidatesById[app.candidateId],
    job: jobsById[app.jobId]
  }));
  // These collections are private/sensitive and are each already served through their
  // own access-controlled endpoint (aiChats -> /api/ai-insight, filtered by ownerId;
  // settings -> /api/settings/:category, filtered by role incl. SMTP credentials and
  // security policy; userProfiles -> /api/settings/profile, per-user; settingsAudit ->
  // /api/settings-audit, admin-only; notificationReads -> /api/notifications). Spreading
  // the raw db here would hand all of that to every logged-in user regardless of role.
  const { aiChats, settings, userProfiles, settingsAudit, notificationReads, activities, ...sharedDb } = db;
  return { ...sharedDb, jobs: Object.values(jobsById), applications };
}

function dashboard(db) {
  const openJobs = db.jobs.filter((job) => job.status === "open");
  const pendingResumes = db.websiteResumes.filter((resume) => !resume.processed);
  const stageCounts = Object.fromEntries(STAGES.map((stage) => [stage, db.applications.filter((app) => normalizeStage(app.stage) === stage).length]));
  const sourceCounts = db.candidates.reduce((acc, candidate) => {
    acc[candidate.source] = (acc[candidate.source] || 0) + 1;
    return acc;
  }, {});
  return {
    kpis: {
      totalCandidates: db.candidates.length,
      openJobs: openJobs.length,
      pendingResumes: pendingResumes.length,
      interviews: db.applications.filter((app) => normalizeStage(app.stage) === "Interview").length,
      offers: db.applications.filter((app) => normalizeStage(app.stage) === "Final Decision").length,
      avgMatch: Math.round(db.applications.reduce((sum, app) => sum + app.matchScore, 0) / Math.max(db.applications.length, 1))
    },
    stageCounts,
    sourceCounts,
    recentActivities: db.activities.slice(-6).reverse()
  };
}

function upsertCandidate(db, parsed, duplicateAction = "skip") {
  const duplicate = db.candidates.find((candidate) =>
    parsed.email && candidate.email && candidate.email.toLowerCase() === parsed.email.toLowerCase()
  );

  if (duplicate) {
    const existingSkills = new Set((duplicate.skills || []).map((skill) => skill.toLowerCase()));
    const newSkills = (parsed.skills || []).filter((skill) => !existingSkills.has(skill.toLowerCase()));
    const changed = candidateFingerprint(duplicate) !== candidateFingerprint(parsed) || newSkills.length > 0;
    if (duplicateAction === "rename" && changed) {
      parsed.name = nextDuplicateName(db, parsed.name || duplicate.name);
      parsed.duplicateOf = duplicate.id;
      parsed.duplicateReason = `Updated profile detected. New skills: ${newSkills.join(", ") || "resume text changed"}.`;
      db.candidates.push(parsed);
      refreshAtsReport(db, parsed);
      return { candidate: parsed, duplicate: true, renamed: true, changed, newSkills };
    }
    if (duplicateAction === "skip") {
      return { candidate: duplicate, duplicate: true, skipped: true, changed, newSkills };
    }
    Object.assign(duplicate, {
      ...parsed,
      id: duplicate.id,
      source: duplicate.source || parsed.source,
      status: duplicate.status || "active",
      createdAt: duplicate.createdAt || parsed.createdAt,
      updatedAt: new Date().toISOString()
    });
    refreshAtsReport(db, duplicate);
    return { candidate: duplicate, duplicate: true, changed, newSkills };
  }

  db.candidates.push(parsed);
  refreshAtsReport(db, parsed);
  return { candidate: parsed, duplicate: false };
}

function assignCandidateToBestJobs(db, candidate, preferredJobId = "") {
  const openJobs = db.jobs.filter((job) => job.status === "open");
  const ranked = rankMatches(openJobs.map((job) => ({ job, ...scoreMatch(candidate, job, db) })));

  const preferred = preferredJobId ? ranked.find((item) => item.job.id === preferredJobId) : null;
  const selected = uniq([preferred, ...ranked.filter((item) => item.matchScore >= 60)].filter(Boolean).slice(0, 3));
  const applications = [];

  for (const item of selected) {
    if (db.applications.some((app) => app.candidateId === candidate.id && app.jobId === item.job.id)) continue;
    const stage = item.matchScore >= 85 ? "Matched Candidates" : "Applied";
    const app = {
      id: id("a"),
      candidateId: candidate.id,
      jobId: item.job.id,
      stage,
      matchScore: item.matchScore,
      skillGaps: item.skillGaps,
      matchedSkills: item.matchedSkills,
      recommendation: item.recommendation,
      notes: `AI match: ${item.recommendation}. ${item.matchedSkills.length ? `Matched ${item.matchedSkills.join(", ")}.` : "Review manually."}`,
      appliedAt: new Date().toISOString()
    };
    db.applications.push(app);
    applications.push(app);
  }

  return { ranked, applications };
}

function addCandidateToJob(db, candidateId, jobId, stage = "Applied") {
  const candidate = db.candidates.find((item) => item.id === candidateId);
  const job = db.jobs.find((item) => item.id === jobId);
  if (!candidate || !job) throw new Error("Candidate or job was not found.");
  const match = scoreMatch(candidate, job, db);
  const existing = db.applications.find((app) => app.candidateId === candidateId && app.jobId === jobId);
  if (existing) {
    existing.stage = STAGES.includes(stage) ? stage : existing.stage;
    existing.matchScore = match.matchScore;
    existing.skillGaps = match.skillGaps;
    existing.matchedSkills = match.matchedSkills;
    existing.recommendation = match.recommendation;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }
  const app = {
    id: id("a"),
    candidateId,
    jobId,
    stage: STAGES.includes(stage) ? stage : "Applied",
    matchScore: match.matchScore,
    skillGaps: match.skillGaps,
    matchedSkills: match.matchedSkills,
    recommendation: match.recommendation,
    notes: `Added to job from beta workspace. ${match.matchedSkills.length ? `Matched ${match.matchedSkills.join(", ")}.` : "Review manually."}`,
    appliedAt: new Date().toISOString()
  };
  db.applications.push(app);
  return app;
}

async function syncWebsiteResumes(db, defaultDuplicateAction = "skip") {
  const imported = [];
  const skipped = [];
  for (const resume of db.websiteResumes.filter((item) => !item.processed)) {
    if (resume.extractionQuality === "poor") {
      resume.needsReview = true;
      skipped.push({ resume, reason: "poor text extraction" });
      continue;
    }

    const parsed = await parseResumeWithAi(resume, db);
    const duplicateAction = resume.duplicateAction || defaultDuplicateAction;
    const { candidate, duplicate, renamed, skipped: duplicateSkipped, changed, newSkills } = upsertCandidate(db, parsed, duplicateAction);
    if (duplicateSkipped) {
      resume.needsReview = changed;
      resume.duplicateSuggestion = changed
        ? `Updated duplicate found. Suggested action: save as ${nextDuplicateName(db, parsed.name)} or review new skills: ${newSkills.join(", ") || "resume text changed"}.`
        : "Exact duplicate found. Suggested action: skip.";
      skipped.push({ resume, reason: resume.duplicateSuggestion, duplicate: true, changed, newSkills });
      if (!changed) resume.processed = true;
      continue;
    }
    const matching = assignCandidateToBestJobs(db, candidate, resume.jobId);

    resume.processed = true;
    resume.candidateId = candidate.id;
    resume.processedAt = new Date().toISOString();
    resume.parsedBy = candidate.parsedBy;
    resume.roleCategory = candidate.roleCategory;
    resume.seniority = candidate.seniority;
    resume.duplicateDecision = renamed ? "renamed" : duplicate ? "updated" : "new";
    imported.push({
      candidate,
      duplicate,
      renamed,
      jobId: matching.ranked[0]?.job.id || resume.jobId,
      topMatch: matching.ranked[0] ? { jobId: matching.ranked[0].job.id, title: matching.ranked[0].job.title, score: matching.ranked[0].matchScore } : null,
      applications: matching.applications.length
    });
  }

  if (imported.length) {
    db.activities.push({
      id: id("act"),
      message: `${imported.length} resume${imported.length === 1 ? "" : "s"} parsed and synced into ASJ ATS.`,
      createdAt: new Date().toISOString()
    });
  }

  if (skipped.length) {
    db.activities.push({
      id: id("act"),
      message: `${skipped.length} resume${skipped.length === 1 ? "" : "s"} need manual review or OCR before candidate import.`,
      createdAt: new Date().toISOString()
    });
  }

  return { imported, skipped };
}

function resumeFilePath(resume) {
  if (resume.sourcePath && existsSync(resume.sourcePath)) return resume.sourcePath;
  const uploadName = String(resume.resumeUrl || "").startsWith("/uploads/") ? basename(resume.resumeUrl) : "";
  return uploadName ? join(UPLOAD_DIR, uploadName) : "";
}

async function processResumeQueue() {
  if (resumeQueueRunning) return;
  resumeQueueRunning = true;
  try {
    while (true) {
      const db = readDb();
      const queued = db.websiteResumes
        .filter((resume) => !resume.processed && !["Parsing", "Parsed"].includes(resume.queueStatus || ""))
        .slice(0, RESUME_WORKERS);
      if (!queued.length) break;

      await Promise.all(queued.map(async (resume) => {
        resume.queueStatus = "Parsing";
        resume.queueMessage = "Extracting text";
        resume.startedAt = new Date().toISOString();
      }));
      writeDb(db);

      await Promise.all(queued.map(async (resume) => {
        try {
          const filePath = resumeFilePath(resume);
          if (!filePath || !existsSync(filePath)) throw new Error("Uploaded file is missing.");
          const parsedText = resume.parser === "manual-text" && resume.resumeText
            ? { text: resume.resumeText, parser: "manual-text", quality: scoreExtractionQuality(resume.resumeText) }
            : extractResumeText(readFileSync(filePath), resume.fileName || basename(filePath), filePath);
          resume.resumeText = parsedText.text || `${resume.fileName || "Resume"} imported, but text extraction returned very little content. Review manually or install OCR for scanned/image resumes.`;
          resume.parser = parsedText.parser;
          resume.extractionQuality = parsedText.quality;
          if (parsedText.quality === "poor") {
            resume.needsReview = true;
            resume.queueStatus = "Failed";
            resume.queueMessage = "Text extraction failed. OCR/manual review needed.";
            return;
          }
          const parsed = parseResume(resume.resumeText, resume.source, resume.resumeUrl);
          const { candidate, duplicate, renamed, skipped: duplicateSkipped, changed, newSkills } = upsertCandidate(db, parsed, resume.duplicateAction || "skip");
          if (duplicateSkipped) {
            resume.needsReview = changed;
            resume.duplicateSuggestion = changed
              ? `Updated duplicate found. Suggested action: save as ${nextDuplicateName(db, parsed.name)} or review new skills: ${newSkills.join(", ") || "resume text changed"}.`
              : "Exact duplicate found. Suggested action: skip.";
            resume.processed = !changed;
            resume.queueStatus = changed ? "Failed" : "Parsed";
            resume.queueMessage = resume.duplicateSuggestion;
            return;
          }
          const matching = assignCandidateToBestJobs(db, candidate, resume.jobId);
          resume.processed = true;
          resume.candidateId = candidate.id;
          resume.processedAt = new Date().toISOString();
          resume.parsedBy = candidate.parsedBy;
          resume.roleCategory = candidate.roleCategory;
          resume.seniority = candidate.seniority;
          resume.duplicateDecision = renamed ? "renamed" : duplicate ? "updated" : "new";
          resume.queueStatus = "Parsed";
          resume.queueMessage = matching.ranked[0] ? `Parsed and matched to ${matching.ranked[0].job.title}.` : "Parsed and ready for recruiter review.";
        } catch (error) {
          resume.queueStatus = "Failed";
          resume.queueMessage = error.message;
          resume.needsReview = true;
        }
      }));

      db.activities.push({
        id: id("act"),
        message: `Resume queue processed ${queued.length} file${queued.length === 1 ? "" : "s"} in background.`,
        createdAt: new Date().toISOString()
      });
      writeDb(db);
    }
  } finally {
    resumeQueueRunning = false;
  }
}

function enqueueResumeProcessing() {
  setTimeout(() => {
    processResumeQueue().catch((error) => console.error(`Resume queue failed: ${error.message}`));
  }, 10);
}

function resumeQueueStats(db) {
  const counts = { Uploaded: 0, Parsing: 0, Parsed: 0, Failed: 0 };
  for (const resume of db.websiteResumes) {
    const status = resume.queueStatus || (resume.processed ? "Parsed" : resume.extractionQuality === "poor" ? "Failed" : "Uploaded");
    counts[counts[status] === undefined ? "Uploaded" : status] += 1;
  }
  const processed = counts.Parsed + counts.Failed;
  const total = db.websiteResumes.length;
  return {
    ...counts,
    total,
    processed,
    remaining: Math.max(0, total - processed),
    percent: total ? Math.round((processed / total) * 100) : 0,
    workers: RESUME_WORKERS,
    running: resumeQueueRunning
  };
}

async function importResumeFolder(db, folderPath, jobId) {
  const folder = resolve(folderPath);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    throw new Error("Enter a valid folder path that exists on this Mac.");
  }

  const files = findResumeFiles(folder);
  if (files.length > MAX_BULK_RESUMES) {
    throw new Error(`Found ${files.length} resumes. Import at most ${MAX_BULK_RESUMES} at a time or increase MAX_BULK_RESUMES.`);
  }

  const existingPaths = new Set(db.websiteResumes.map((resume) => resume.sourcePath).filter(Boolean));
  const imported = [];
  const skipped = [];
  const failed = [];

  for (const file of files) {
    if (existingPaths.has(file)) {
      skipped.push({ file, reason: "already imported" });
      continue;
    }

    try {
      const buffer = readFileSync(file);
      const resume = await addResumeToInbox(db, {
        buffer,
        filename: basename(file),
        jobId,
        source: "Bulk Folder Import",
        sourcePath: file
      });
      imported.push({ id: resume.id, file, quality: resume.extractionQuality });
    } catch (error) {
      failed.push({ file, error: error.message });
    }
  }

  db.activities.push({
    id: id("act"),
    message: `${imported.length} resume${imported.length === 1 ? "" : "s"} imported from ${folder}. ${skipped.length} skipped, ${failed.length} failed.`,
    createdAt: new Date().toISOString()
  });

  return { folder, found: files.length, imported, skipped, failed };
}

function deleteStoredResumeFile(resume) {
  const filePath = resumeDiskPath(resume);
  if (!filePath || !filePath.startsWith(UPLOAD_DIR)) return;
  try {
    unlinkSync(filePath);
  } catch {
    // Database delete should still complete when the file is already gone.
  }
}

function updateResumeReview(db, resumeId, body) {
  const resume = db.websiteResumes.find((item) => item.id === resumeId);
  if (!resume) throw new Error("Resume not found");
  if (typeof body.resumeText === "string") {
    resume.resumeText = cleanExtractedText(body.resumeText);
    resume.parser = "manual-review";
    resume.extractionQuality = scoreExtractionQuality(resume.resumeText);
    resume.needsReview = resume.extractionQuality === "poor";
    if (resume.candidateId) {
      // Previously this deleted resume.candidateId and set processed = false,
      // which orphaned the existing candidate record until someone manually
      // clicked "Re-read Uploaded Files". That meant edits made here (name,
      // details, etc.) were invisible everywhere else (Candidate Management,
      // Pipeline, Outreach...) until that manual reparse. Instead, keep the
      // link and push the corrected text straight into the linked candidate now.
      resume.processed = updateCandidateFromResume(db, resume);
    } else {
      // Never linked to a candidate yet (e.g. still queued) -- let the normal
      // processing pipeline pick it up rather than trying to link it here.
      resume.processed = false;
      enqueueResumeProcessing();
    }
  }
  if (typeof body.fileName === "string" && body.fileName.trim()) {
    resume.fileName = body.fileName.trim();
  }
  resume.reviewedAt = new Date().toISOString();
  db.activities.push({
    id: id("act"),
    message: `${resume.fileName || "Resume"} reviewed and updated in Resume Inbox.`,
    createdAt: new Date().toISOString()
  });
  return resume;
}

function talentRecommendations(db) {
  const hydrated = hydrate(db);
  const openJobs = hydrated.jobs.filter((job) => job.status === "open");
  const candidates = hydrated.candidates.filter((candidate) => candidate.status === "active");
  const jobMatches = openJobs.map((job) => {
    const matches = rankMatches(candidates.map((candidate) => ({ candidate, ...scoreMatch(candidate, job, db) })))
      .slice(0, 5);
    return {
      jobId: job.id,
      title: job.title,
      client: job.client,
      topScore: matches[0]?.matchScore || 0,
      topCandidates: matches.map((match) => ({
        candidateId: match.candidate.id,
        name: match.candidate.name,
        role: match.candidate.currentRole,
        score: match.matchScore,
        recommendation: match.recommendation,
        gaps: match.skillGaps
      }))
    };
  });

  const topCandidates = candidates.map((candidate) => {
    const best = rankMatches(openJobs.map((job) => ({ job, ...scoreMatch(candidate, job, db) })))[0];
    return {
      candidateId: candidate.id,
      name: candidate.name,
      role: candidate.currentRole,
      roleCategory: candidate.roleCategory,
      seniority: candidate.seniority,
      skills: candidate.skills || [],
      bestJob: best ? best.job.title : "No open job",
      score: best?.matchScore || 0,
      recommendation: best?.recommendation || "not matched",
      marketFit: candidate.marketFit || candidate.aiSummary
    };
  }).sort((a, b) => b.score - a.score).slice(0, 8);

  const attention = [
    ...db.websiteResumes.filter((resume) => !resume.processed && resume.extractionQuality !== "poor").map((resume) => `${resume.fileName || "Resume"} is ready for AI parse/import.`),
    ...db.websiteResumes.filter((resume) => resume.extractionQuality === "poor").map((resume) => `${resume.fileName || "Resume"} needs OCR/manual review.`),
    ...jobMatches.filter((job) => job.topScore < 60).map((job) => `${job.title} needs sourcing: no strong candidate match yet.`)
  ].slice(0, 6);

  return {
    topCandidates,
    jobMatches,
    attention,
    marketSignals: [
      "Prioritise AI/ML, cloud, data, and full-stack profiles with shipped project evidence.",
      "Shortlist by matched skills plus role category; keep partial skill gaps visible for recruiter review.",
      "Use seniority and current-role fit before moving candidates beyond Matched Candidates."
    ]
  };
}

async function cohereInsight(prompt, db) {
  const localBrief = (reason = "") => {
    const recs = talentRecommendations(db);
    return [
      "AI ATS Intelligence Brief",
      reason || "Live local ATS ranking is active.",
      "",
      "Top Candidates",
      ...recs.topCandidates.slice(0, 5).map((candidate, index) => `${index + 1}. ${candidate.name} - ${candidate.bestJob} (${candidate.score}%, ${candidate.recommendation})`),
      "",
      "Needs Attention",
      ...(recs.attention.length ? recs.attention : ["No urgent ATS issues detected."])
    ].join("\n");
  };

  if (!process.env.COHERE_API_KEY) {
    return localBrief("External AI key is not configured. Using the live local ATS ranking engine.");
  }

  const context = {
    openJobs: db.jobs.filter((job) => job.status === "open").map((job) => ({ title: job.title, skills: job.skills })),
    candidates: db.candidates.map((candidate) => ({ name: candidate.name, role: candidate.currentRole, skills: candidate.skills })),
    applications: db.applications.map((app) => ({ stage: app.stage, score: app.matchScore, gaps: app.skillGaps })),
    recommendations: talentRecommendations(db)
  };

  try {
    return await callCohereText([
      { role: "system", content: "You are ASJ ATS Intelligence, an embedded AI recruiter co-pilot inside an internal ATS. Write like a senior recruiter assistant: concise, direct, operational, and data-driven. Use short titled sections, plain sentences, and recruiter actions. Focus on top candidates, job coverage, match gaps, interview readiness, outreach next steps, and risk flags. Avoid markdown hashes, decorative formatting, long introductions, and generic AI disclaimers. Prefer this structure when useful: AI Brief, Strongest Matches, Coverage Risks, Next Actions." },
      { role: "user", content: `${prompt}\n\nCurrent ATS data:\n${JSON.stringify(context)}` }
    ], 700) || localBrief("External AI returned no text. Using live local ATS ranking.");
  } catch (error) {
    return localBrief(`External AI request failed. Using live local ATS ranking. Detail: ${error.message.slice(0, 160)}`);
  }
}

async function outreachDraft({ candidateIds = [], jobId = "", type = "individual" }, db) {
  const candidates = candidateIds
    .map((candidateId) => db.candidates.find((candidate) => candidate.id === candidateId))
    .filter(Boolean);
  const job = db.jobs.find((item) => item.id === jobId) || db.jobs.find((item) => item.status === "open");
  const lead = candidates[0] || db.candidates[0];
  const title = job?.title || "an ASJ Recruitment opportunity";
  const subjectPrefix = type === "interview" ? "Interview invitation" : type === "follow-up" ? "Following up" : "Opportunity";
  const fallback = {
    subject: `${subjectPrefix}: ${title}`,
    message: `Hi ${type === "individual" ? (lead?.name || "Candidate") : "{{name}"},

I hope you are well. ASJ Recruitment reviewed your profile and your experience in ${(lead?.skills || []).slice(0, 4).join(", ") || "your technical background"} looks aligned with ${title}${job?.location ? ` based around ${job.location}` : ""}.

We would like to discuss the role, your availability, and next steps. Please reply with a suitable time for a quick conversation.

Regards,
ASJ Recruitment Team`,
    aiUsed: false
  };

  if (!process.env.COHERE_API_KEY) return fallback;

  const context = {
    outreachType: type,
    useNamePlaceholderForBulk: type !== "individual",
    job: job ? { title: job.title, location: job.location, skills: job.skills, description: job.description } : null,
    candidates: candidates.map((candidate) => ({
      name: candidate.name,
      role: candidate.currentRole,
      email: candidateEmail(candidate),
      skills: candidate.skills,
      summary: candidate.aiSummary,
      experienceYears: candidate.experienceYears
    }))
  };

  try {
    const text = await callCohereText([
      { role: "system", content: "You write concise recruiting outreach for ASJ Recruitment. Return only JSON with subject and message. The message must be plain text, warm, specific, and professional. For bulk outreach, greet with Hi {{name}}, so each candidate can be personalized before sending. Do not invent contact details." },
      { role: "user", content: `Create an outreach email draft.\n\nContext:\n${JSON.stringify(context)}` }
    ], 500);
    const parsed = parseJsonObject(text);
    let subject = String(parsed.subject || fallback.subject).trim();
    let message = String(parsed.message || fallback.message).trim();
    if (type === "individual" && lead) {
      subject = personalizeOutreach(subject, lead, job);
      message = personalizeOutreach(message, lead, job);
    } else {
      subject = subject
        .replace(/\{\{\s*role\s*\}\}/gi, "candidate")
        .replace(/\{\{\s*skills\s*\}\}/gi, "technical background");
      message = message
        .replace(/\{\{\s*role\s*\}\}/gi, "candidate")
        .replace(/\{\{\s*skills\s*\}\}/gi, "relevant technical skills")
        .replace(/experience as a candidate/gi, "experience")
        .replace(/background in relevant technical skills/gi, "technical background");
    }
    return {
      subject,
      message,
      aiUsed: true
    };
  } catch {
    return fallback;
  }
}

function personalizeOutreach(value, candidate, job) {
  return String(value || "")
    .replace(/\{\{\s*name\s*\}\}/gi, candidate.name || "Candidate")
    .replace(/\{\{\s*candidateName\s*\}\}/gi, candidate.name || "Candidate")
    .replace(/\{\{\s*role\s*\}\}/gi, candidate.currentRole || "candidate")
    .replace(/\{\{\s*skills\s*\}\}/gi, (candidate.skills || []).slice(0, 5).join(", ") || "your technical background")
    .replace(/\{\{\s*jobTitle\s*\}\}/gi, job?.title || "the role")
    .replace(/\{\{\s*jobLocation\s*\}\}/gi, job?.location || "");
}

function smtpConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

function smtpRead(socket, timeout = 20000) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("SMTP timeout"));
    }, timeout);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/).filter(Boolean);
      if (lines.length && /^\d{3}\s/.test(lines[lines.length - 1])) {
        cleanup();
        resolve(buffer);
      }
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function smtpCommand(socket, command, expected = /^[23]/) {
  if (command) socket.write(`${command}\r\n`);
  const response = await smtpRead(socket);
  if (!expected.test(response)) throw new Error(response.trim());
  return response;
}

function smtpData(message) {
  return String(message || "").replace(/^\./gm, "..");
}

async function sendSmtpMail({ to, subject, message }) {
  if (!smtpConfigured()) {
    return { status: "queued", detail: "SMTP is not configured. Email was logged only." };
  }

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const from = process.env.SMTP_FROM;
  const socket = secure
    ? connectTls({ host, port, servername: host })
    : connectNet({ host, port });

  try {
    await smtpCommand(socket, "", /^220/);
    await smtpCommand(socket, `EHLO ${process.env.SMTP_HELO || "asj-ats-beta.local"}`);
    if (!secure && String(process.env.SMTP_STARTTLS || "true").toLowerCase() !== "false") {
      await smtpCommand(socket, "STARTTLS", /^220/);
      const tlsSocket = connectTls({ socket, servername: host });
      await smtpCommand(tlsSocket, `EHLO ${process.env.SMTP_HELO || "asj-ats-beta.local"}`);
      return await sendSmtpEnvelope(tlsSocket, { from, to, subject, message });
    }
    return await sendSmtpEnvelope(socket, { from, to, subject, message });
  } catch (error) {
    socket.destroy();
    throw error;
  }
}

async function sendSmtpEnvelope(socket, { from, to, subject, message }) {
  const user = process.env.SMTP_USER || "";
  const pass = process.env.SMTP_PASS || "";
  if (user && pass) {
    await smtpCommand(socket, "AUTH LOGIN", /^334/);
    await smtpCommand(socket, Buffer.from(user).toString("base64"), /^334/);
    await smtpCommand(socket, Buffer.from(pass).toString("base64"), /^235/);
  }
  await smtpCommand(socket, `MAIL FROM:<${from}>`);
  await smtpCommand(socket, `RCPT TO:<${to}>`);
  await smtpCommand(socket, "DATA", /^354/);
  const raw = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    smtpData(message),
    "."
  ].join("\r\n");
  await smtpCommand(socket, raw);
  await smtpCommand(socket, "QUIT", /^221|^[23]/);
  socket.end();
  return { status: "sent", detail: "Sent through configured SMTP provider." };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Notifications are computed live from actual data each time they're requested (not
// stored) -- this keeps them honest: nothing here is a canned/fake alert, and there's
// nothing to keep in sync with the records they describe. IDs are derived from the
// source record so "mark as read" (tracked in db.notificationReads) stays stable
// across requests even though the list itself is recomputed every time.
function computeNotifications(db, currentUser) {
  const notifications = [];
  const now = Date.now();
  const candidateById = new Map(db.candidates.map((c) => [c.id, c]));
  const jobById = new Map(db.jobs.map((j) => [j.id, j]));
  const isAdmin = currentUser.role === "admin";
  // Non-admins only see job/pipeline-related notifications for jobs assigned to them.
  // Legacy jobs created before assignment tracking existed (assignedRecruiterId unset)
  // fall back to visible-to-everyone-with-jobs-access, rather than disappearing for
  // everyone -- otherwise pre-existing data would look like it vanished.
  const isJobRelevant = (job) => isAdmin || !job.assignedRecruiterId || job.assignedRecruiterId === currentUser.id;

  // Resume parsing completed (last 3 days) -- relevant to anyone who can see Resume Management
  if (roleCanView(currentUser.role, "inbox")) {
    db.websiteResumes.forEach((resume) => {
      if (!resume.processed || !resume.candidateId) return;
      const ts = resume.reparsedAt || resume.processedAt || resume.reviewedAt || resume.submittedAt;
      if (!ts || now - new Date(ts).getTime() > 3 * DAY_MS) return;
      const candidate = candidateById.get(resume.candidateId);
      notifications.push({
        id: `resume:${resume.id}`, category: "resume_parsing",
        title: "Resume parsing completed",
        message: `${candidate?.name || resume.fileName || "A resume"} was parsed and added to Candidates.`,
        createdAt: ts, targetView: "inbox", targetId: resume.id
      });
    });
  }

  // Top candidate alerts: applications scoring 90%+ on jobs assigned to this user
  db.applications.forEach((app) => {
    if (!(app.matchScore >= 90)) return;
    const candidate = candidateById.get(app.candidateId);
    const job = jobById.get(app.jobId);
    if (!candidate || !job || !isJobRelevant(job)) return;
    notifications.push({
      id: `top:${app.id}`, category: "top_candidate",
      title: "Top candidate match",
      message: `${candidate.name} scored ${app.matchScore}% for ${job.title}.`,
      createdAt: app.appliedAt || new Date().toISOString(), targetView: "pipeline", targetId: job.id
    });
  });

  // Candidate recommendations: strong (80-89%) matches, one notification per job
  const strongByJob = new Map();
  db.applications.forEach((app) => {
    if (!(app.matchScore >= 80 && app.matchScore < 90)) return;
    const job = jobById.get(app.jobId);
    if (!job || !isJobRelevant(job)) return;
    strongByJob.set(job.id, (strongByJob.get(job.id) || 0) + 1);
  });
  strongByJob.forEach((count, jobId) => {
    const job = jobById.get(jobId);
    notifications.push({
      id: `rec:${jobId}`, category: "candidate_recommendation",
      title: "Candidate recommendations",
      message: `${count} strong candidate${count === 1 ? "" : "s"} recommended for ${job.title}.`,
      createdAt: job.createdAt || new Date().toISOString(), targetView: "pipeline", targetId: jobId
    });
  });

  // New job matches: jobs opened in the last 7 days that already have applicants
  db.jobs.forEach((job) => {
    if (!job.createdAt || now - new Date(job.createdAt).getTime() > 7 * DAY_MS) return;
    if (!isJobRelevant(job)) return;
    const count = db.applications.filter((app) => app.jobId === job.id).length;
    if (!count) return;
    notifications.push({
      id: `jobmatch:${job.id}`, category: "job_match",
      title: "New job matches",
      message: `${count} candidate${count === 1 ? "" : "s"} matched to the new ${job.title} role.`,
      createdAt: job.createdAt, targetView: "jobs", targetId: job.id
    });
  });

  // Compliance alerts: only for roles that can actually see Compliance
  if (roleCanView(currentUser.role, "compliance")) {
    const reminderDays = db.settings?.compliance?.expiryReminderDays ?? 30;
    db.candidates.forEach((candidate) => {
      (candidate.complianceDocuments || []).forEach((doc) => {
        if (!doc.expiryDate) return;
        const daysLeft = (new Date(doc.expiryDate).getTime() - now) / DAY_MS;
        if (daysLeft < 0 || daysLeft > reminderDays) return;
        notifications.push({
          id: `compliance:${candidate.id}:${doc.id || doc.type}`, category: "compliance",
          title: "Compliance document expiring",
          message: `${candidate.name}'s ${doc.type || "document"} expires in ${Math.max(0, Math.ceil(daysLeft))} day(s).`,
          createdAt: new Date().toISOString(), targetView: "compliance", targetId: candidate.id
        });
      });
    });
  }

  // Upcoming interviews: applications currently sitting in the Interview stage, on jobs relevant to this user
  db.applications.forEach((app) => {
    if (normalizeStage(app.stage) !== "Interview") return;
    const candidate = candidateById.get(app.candidateId);
    const job = jobById.get(app.jobId);
    if (!candidate || !job || !isJobRelevant(job)) return;
    notifications.push({
      id: `interview:${app.id}`, category: "interview",
      title: "Upcoming interview",
      message: `${candidate.name} is in the interview stage for ${job.title}.`,
      createdAt: app.appliedAt || new Date().toISOString(), targetView: "pipeline", targetId: job.id
    });
  });

  // AI insights: only this user's own ATS Intelligence conversations -- never anyone else's
  (db.aiChats || []).filter((chat) => chat.ownerId === currentUser.id).slice(-5).forEach((chat) => {
    if (!chat.text) return;
    notifications.push({
      id: `ai:${chat.id}`, category: "ai_insight",
      title: "AI insight",
      message: chat.text.split("\n").find((line) => line.trim())?.slice(0, 140) || "New AI insight is ready.",
      createdAt: chat.createdAt, targetView: "ai", targetId: chat.id
    });
  });

  // Market/job trend: org-wide metric, only for roles that can see Reports
  if (roleCanView(currentUser.role, "reports")) {
    const uploadsThisWeek = db.websiteResumes.filter((r) => now - new Date(r.submittedAt).getTime() <= 7 * DAY_MS).length;
    const uploadsLastWeek = db.websiteResumes.filter((r) => {
      const age = now - new Date(r.submittedAt).getTime();
      return age > 7 * DAY_MS && age <= 14 * DAY_MS;
    }).length;
    if (uploadsThisWeek > 0 || uploadsLastWeek > 0) {
      const delta = uploadsThisWeek - uploadsLastWeek;
      const trendWord = delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      notifications.push({
        id: `trend:${new Date().toISOString().slice(0, 10)}`, category: "market_trend",
        title: "Candidate supply trend",
        message: `Resume uploads are ${trendWord} this week: ${uploadsThisWeek} vs ${uploadsLastWeek} last week.`,
        createdAt: new Date().toISOString(), targetView: "reports"
      });
    }
  }

  // System alerts -- admin only, these are org-infrastructure concerns, not individual work
  if (isAdmin) {
    const needsReviewCount = db.websiteResumes.filter((r) => r.needsReview || r.extractionQuality === "poor").length;
    if (needsReviewCount > 5) {
      notifications.push({
        id: "system:review-backlog", category: "system",
        title: "Resume review backlog",
        message: `${needsReviewCount} resumes need manual review in Resume Management.`,
        createdAt: new Date().toISOString(), targetView: "inbox"
      });
    }
    if (!process.env.COHERE_API_KEY) {
      notifications.push({
        id: "system:local-ai", category: "system",
        title: "Using local ranking engine",
        message: "No external AI key configured -- candidate matching is running on the local ATS ranking engine.",
        createdAt: new Date().toISOString(), targetView: "settings:system"
      });
    }
  }

  // Targeted admin-triggered notifications for this specific user (role changes, etc.)
  (db.directNotifications || []).filter((n) => n.userId === currentUser.id).forEach((n) => {
    notifications.push({
      id: n.id, category: n.category || "account",
      title: n.title, message: n.message,
      createdAt: n.createdAt, targetView: n.targetView || ""
    });
  });

  return notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function systemStatus(db) {
  const ocrAvailable = existsSync("/opt/homebrew/bin/tesseract") || existsSync("/usr/local/bin/tesseract");
  const pending = db.websiteResumes.filter((resume) => !resume.processed).length;
  const needsReview = db.websiteResumes.filter((resume) => resume.extractionQuality === "poor").length;
  return {
    generatedAt: new Date().toISOString(),
    ai: {
      status: process.env.COHERE_API_KEY ? "configured" : "local-ranking",
      label: process.env.COHERE_API_KEY ? "External AI key configured" : "Using local ATS ranking engine"
    },
    email: {
      status: process.env.SMTP_HOST && process.env.SMTP_FROM ? "configured" : "not-configured",
      label: process.env.SMTP_HOST && process.env.SMTP_FROM ? `Sending from ${process.env.SMTP_FROM}` : "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and SMTP_FROM to send real emails"
    },
    ocr: {
      status: ocrAvailable ? "available" : "not-installed",
      label: ocrAvailable ? "Image resume OCR available" : "Image resumes accepted; install Tesseract for OCR text extraction"
    },
    storage: {
      status: existsSync(UPLOAD_DIR) ? "ready" : "missing",
      label: `${db.websiteResumes.length} inbox resume(s), ${pending} pending, ${needsReview} need review`
    },
    parser: {
      status: "ready",
      label: "PDF, Word, image, single file, and folder import enabled"
    }
  };
}

function contentTypeForFile(file) {
  return contentTypeForExtension(extname(file).toLowerCase());
}

function contentTypeForExtension(extension) {
  const types = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  };
  return types[extension] || "application/octet-stream";
}

async function serveUpload(req, res, url) {
  if (url.pathname.startsWith("/uploads/")) {
    const uploadName = basename(url.pathname.replace("/uploads/", ""));
    const stored = await readStoredObject(uploadName);
    if (!stored) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": stored.contentType,
      "Content-Disposition": `inline; filename="${stored.fileName.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store"
    });
    if (req.method === "HEAD") res.end();
    else res.end(stored.body);
    return true;
  }
  return false;
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = resolve(PUBLIC_DIR, requested);
  if (!file.startsWith(PUBLIC_DIR) || !existsSync(file)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  res.writeHead(200, {
    "Content-Type": types[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });
  res.end(readFileSync(file));
}

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  applySecurityHeaders(req, res);
  if (req.method === "OPTIONS") return json(res, 204, {});

  // Rate limit every request by client IP. Auth/login-style routes get a much
  // tighter budget since they're the most valuable target for brute-forcing.
  const ip = clientIp(req);
  const isAuthRoute = url.pathname.startsWith("/auth/") || url.pathname === "/auth";
  const limitOk = isAuthRoute
    ? checkRateLimit(`auth:${ip}`, AUTH_RATE_LIMIT_MAX)
    : checkRateLimit(`api:${ip}`, RATE_LIMIT_MAX);
  if (!limitOk) {
    return json(res, 429, { error: "Too many requests. Please slow down and try again shortly." });
  }

  try {
    if (url.pathname.startsWith("/uploads/")) {
      const currentUser = await authenticateApiRequest(req);
      if (!currentUser) return json(res, 401, { error: "Not authenticated. Please sign in again." });
      await serveUpload(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/auth/") || url.pathname === "/auth" || url.pathname.startsWith("/api/users")) {
      await handleAuthRequest(req, res);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { ok: true });

      const currentUser = await authenticateApiRequest(req);
      if (!currentUser) return json(res, 401, { error: "Not authenticated. Please sign in again." });
      req.currentUser = currentUser;

      const moduleKey = moduleForApiPath(url.pathname);
      if (moduleKey) {
        const isRead = req.method === "GET" || req.method === "HEAD";
        const allowed = isRead ? roleCanView(currentUser.role, moduleKey) : roleCanEdit(currentUser.role, moduleKey);
        if (!allowed) return json(res, 403, { error: "You don't have permission to do that." });
      }

      const db = readDb();

      if (req.method === "GET" && url.pathname === "/api/all") {
        const hydrated = hydrate(db);
        hydrated.myNotificationReadIds = db.notificationReads[currentUser.id] || [];
        return json(res, 200, hydrated);
      }
      if (req.method === "GET" && url.pathname === "/api/dashboard") return json(res, 200, dashboard(db));
      if (req.method === "GET" && url.pathname === "/api/recommendations") return json(res, 200, talentRecommendations(db));

      // Full explainable match for one candidate/job pair, including real semantic
      // similarity when an embeddings provider is configured. Deliberately NOT used for
      // bulk scoring (dashboard, pipeline auto-scoring) -- this is for a recruiter opening
      // one candidate against one job and wanting the full breakdown behind the number.
      if (req.method === "GET" && /^\/api\/candidates\/[^/]+\/match\/[^/]+$/.test(url.pathname)) {
        const [, , candidateId, , jobId] = url.pathname.split("/");
        const candidate = db.candidates.find((item) => item.id === candidateId);
        const job = db.jobs.find((item) => item.id === jobId);
        if (!candidate || !job) return json(res, 404, { error: "Candidate or job not found" });
        const match = await matchCandidateToJob(candidate, job, matchWeightsFromSettings(db));
        return json(res, 200, match);
      }
      if (req.method === "GET" && url.pathname === "/api/system-status") return json(res, 200, systemStatus(db));

      // ── Settings module ──────────────────────────────────────────────
      // GET /api/settings -> which categories this role can see, plus their current values.
      // Individual category reads/writes below are still independently gated by the
      // centralized moduleForApiPath -> settings_<category> check above, so this listing
      // endpoint is just a convenience aggregate, not an extra trust boundary.
      if (req.method === "GET" && url.pathname === "/api/settings") {
        const allowedCategories = SETTINGS_CATEGORIES.filter((category) => roleCanView(currentUser.role, `settings_${category}`));
        const settings = Object.fromEntries(allowedCategories.map((category) => [category, db.settings[category]]));
        const editable = Object.fromEntries(allowedCategories.map((category) => [category, roleCanEdit(currentUser.role, `settings_${category}`)]));
        return json(res, 200, { categories: allowedCategories, settings, editable });
      }

      if (req.method === "GET" && url.pathname === "/api/settings/profile") {
        const profile = db.userProfiles[currentUser.id] || {};
        return json(res, 200, {
          id: currentUser.id,
          name: currentUser.name,
          email: currentUser.email,
          role: currentUser.role,
          phone: profile.phone || "",
          photoUrl: profile.photoUrl || "",
          mfaEnabled: Boolean(profile.mfaEnabled)
        });
      }

      if (req.method === "PATCH" && url.pathname === "/api/settings/profile") {
        const body = await readJson(req);
        const existing = db.userProfiles[currentUser.id] || {};
        const before = { ...existing };
        if (typeof body.phone === "string") existing.phone = body.phone.trim().slice(0, 30);
        if (typeof body.photoUrl === "string") existing.photoUrl = body.photoUrl.trim().slice(0, 2000);
        if (typeof body.mfaEnabled === "boolean") existing.mfaEnabled = body.mfaEnabled;
        db.userProfiles[currentUser.id] = existing;
        db.settingsAudit.push({
          id: id("aud"), category: "profile", field: Object.keys(body).join(","),
          before, after: existing, actorId: currentUser.id, actorName: currentUser.name, at: new Date().toISOString()
        });
        db.activities.push({ id: id("act"), message: `${currentUser.name} updated their profile settings.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { id: currentUser.id, name: currentUser.name, email: currentUser.email, role: currentUser.role, ...existing });
      }

      // Admin-only full audit trail of every settings change (Security Settings > audit logs).
      if (req.method === "GET" && url.pathname === "/api/settings-audit") {
        if (currentUser.role !== "admin") return json(res, 403, { error: "You don't have permission to do that." });
        return json(res, 200, { entries: db.settingsAudit.slice(-500).reverse() });
      }

      // Global Activity Log -- admin only. This is a separate endpoint (rather than
      // reusing the audit entries bundled into /api/all) specifically so a non-admin
      // can't see the org-wide audit trail just by inspecting the network tab or
      // hitting the URL directly; db.activities isn't included in hydrate()'s payload
      // at all anymore. Belt-and-suspenders explicit role check on top of the
      // centralized moduleForApiPath("activity") gate above.
      if (req.method === "GET" && url.pathname === "/api/activity-log") {
        if (currentUser.role !== "admin") return json(res, 403, { error: "You don't have permission to do that." });
        return json(res, 200, { activities: db.activities.slice(-500).reverse() });
      }

      // Admin-only: push a targeted notification to one specific user. Currently used
      // for "your role was changed" alerts triggered from Settings > User & Role
      // Management, since the role-change mutation itself happens in usersRoutes.js.
      if (req.method === "POST" && url.pathname === "/api/user-notifications") {
        if (currentUser.role !== "admin") return json(res, 403, { error: "You don't have permission to do that." });
        const body = await readJson(req);
        if (!body.userId || !body.title || !body.message) return json(res, 400, { error: "userId, title, and message are required" });
        db.directNotifications.push({
          id: id("unotif"), userId: body.userId, category: body.category || "account",
          title: String(body.title).slice(0, 140), message: String(body.message).slice(0, 300),
          targetView: body.targetView || "", createdAt: new Date().toISOString()
        });
        writeDb(db);
        return json(res, 200, { ok: true });
      }

      if (req.method === "GET" && /^\/api\/settings\/[^/]+$/.test(url.pathname)) {
        const category = url.pathname.split("/")[3];
        if (!SETTINGS_CATEGORIES.includes(category)) return json(res, 404, { error: "Unknown settings category" });
        return json(res, 200, { category, values: db.settings[category] });
      }

      if (req.method === "PATCH" && /^\/api\/settings\/[^/]+$/.test(url.pathname)) {
        const category = url.pathname.split("/")[3];
        if (!SETTINGS_CATEGORIES.includes(category)) return json(res, 404, { error: "Unknown settings category" });
        const body = await readJson(req);
        const validationError = validateSettingsPatch(category, body);
        if (validationError) return json(res, 400, { error: validationError });
        const before = { ...db.settings[category] };
        db.settings[category] = mergeSettingsPatch(db.settings[category], body);
        db.settingsAudit.push({
          id: id("aud"), category, field: Object.keys(body).join(","),
          before, after: db.settings[category], actorId: currentUser.id, actorName: currentUser.name, at: new Date().toISOString()
        });
        db.activities.push({
          id: id("act"),
          message: `${currentUser.name} updated ${SETTINGS_LABELS[category] || category} settings.`,
          createdAt: new Date().toISOString()
        });
        writeDb(db);
        return json(res, 200, { category, values: db.settings[category] });
      }


      if (req.method === "POST" && url.pathname === "/api/jobs/import-url") {
        try {
          const body = await readJson(req);
          if (!body.url) return json(res, 400, { error: "url is required" });
          const job = await importJobFromUrl(body.url);
          db.activities.push({
            id: id("act"),
            message: `Imported job opportunity from URL: ${job.title || body.url}`,
            createdAt: new Date().toISOString()
          });
          writeDb(db);
          return json(res, 200, job);
        } catch (error) {
          console.error(`[job-import] ${error.message}`);
          return json(res, 400, { error: `Unable to import job URL: ${error.message}` });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/sync-resumes") {
        enqueueResumeProcessing();
        return json(res, 202, { message: "Processing in background", queue: resumeQueueStats(db), ...publicState(db) });
      }

      if (req.method === "GET" && url.pathname === "/api/resume-queue") {
        return json(res, 200, { queue: resumeQueueStats(db), ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/reparse-resumes") {
        const result = reparseStoredResumes(db);
        writeDb(db);
        return json(res, 200, { ...result, ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/website-resumes") {
        const body = await readJson(req);
        const resume = {
          id: id("wr"),
          submittedAt: new Date().toISOString(),
          source: "ASJ Website Careers Form",
          jobId: body.jobId,
          processed: false,
          resumeUrl: body.resumeUrl || `website://resume/${Date.now()}`,
          resumeText: body.resumeText || ""
        };
        db.websiteResumes.push(resume);
        writeDb(db);
        return json(res, 201, resume);
      }

      if (req.method === "POST" && url.pathname === "/api/upload-resume") {
        try {
          const resume = await handleResumeUpload(req, db);
          writeDb(db);
          enqueueResumeProcessing();
          return json(res, 202, { resume, message: "Uploaded Successfully. Processing in Background.", queue: resumeQueueStats(db), ...publicState(db) });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/upload-resumes") {
        try {
          const result = await handleBulkResumeUpload(req, db);
          writeDb(db);
          enqueueResumeProcessing();
          return json(res, 202, { ...result, message: "Uploaded Successfully. Processing in Background.", queue: resumeQueueStats(db), ...publicState(db) });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }

      if ((req.method === "PATCH" || req.method === "POST") && url.pathname.startsWith("/api/website-resumes/")) {
        const resumeId = url.pathname.split("/")[3];
        const body = await readJson(req);
        try {
          const resume = updateResumeReview(db, resumeId, body);
          writeDb(db);
          return json(res, 200, { resume, ...publicState(db) });
        } catch (error) {
          return json(res, error.message === "Resume not found" ? 404 : 400, { error: error.message });
        }
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/website-resumes/")) {
        const resumeId = url.pathname.split("/")[3];
        const resume = db.websiteResumes.find((item) => item.id === resumeId);
        if (!resume) return json(res, 404, { error: "Resume not found" });
        deleteStoredResumeFile(resume);
        db.websiteResumes = db.websiteResumes.filter((item) => item.id !== resumeId);
        if (resume.candidateId) {
          db.candidates = db.candidates.filter((item) => item.id !== resume.candidateId);
          db.applications = db.applications.filter((item) => item.candidateId !== resume.candidateId);
        }
        db.activities.push({ id: id("act"), message: `${resume.fileName || "Resume"} deleted from Resume Inbox.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { deleted: resumeId, ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/import-folder") {
        const body = await readJson(req);
        try {
          const result = await importResumeFolder(db, body.folderPath, "");
          writeDb(db);
          return json(res, 201, { ...result, ...publicState(db) });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/extract-job") {
        try {
          let text = "";
          let source = "text";
          if ((req.headers["content-type"] || "").includes("multipart/form-data")) {
            const body = await readRaw(req);
            const parts = parseMultipart(body, req.headers["content-type"] || "");
            const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.body.toString("utf8")]));
            const file = parts.find((part) => part.name === "jobFile" && part.filename);
            text = fields.jobRawText || "";
            source = fields.jobUrl ? "url" : "text";
            if (fields.jobUrl) {
              try {
                const imported = await importJobFromUrl(fields.jobUrl);
                return json(res, 200, { job: jobImportToFormJob(imported), imported });
              } catch (error) {
                if (!text.trim()) throw error;
                text += `\nURL fetch note: ${error.message}`;
              }
            }
            if (file) {
              const parsed = extractResumeText(file.body, file.filename);
              text += `\n${parsed.text}`;
              source = file.filename;
            }
          } else {
            const body = await readJson(req);
            text = body.text || "";
            source = body.url ? "url" : "text";
            if (body.url) {
              try {
                const imported = await importJobFromUrl(body.url);
                return json(res, 200, { job: jobImportToFormJob(imported), imported });
              } catch (error) {
                if (!text.trim()) throw error;
                text += `\nURL fetch note: ${error.message}`;
              }
            }
          }
          if (!cleanExtractedText(text)) return json(res, 400, { error: "Add a job file, URL, or pasted job description." });
          return json(res, 200, { job: extractJobFromText(text, source) });
        } catch (error) {
          return json(res, 400, { error: `Unable to extract job: ${error.message}` });
        }
      }

      if (req.method === "POST" && url.pathname === "/api/jobs") {
        const body = await readJson(req);
        const title = String(body.title || "").trim();
        const description = String(body.description || "").trim();
        if (!title || !description) return json(res, 400, { error: "Job title and description are required" });
        const skills = String(body.skills || "")
          .split(",")
          .map((skill) => skill.trim())
          .filter(Boolean);
        const job = {
          id: id("j"),
          title,
          clientId: body.clientId || db.clients[0]?.id,
          status: body.status || "open",
          location: String(body.location || "Location not set").trim(),
          department: String(body.department || "Recruitment").trim(),
          employmentType: String(body.employmentType || "Full time").trim(),
          priority: body.priority || "Medium",
          clearance: body.clearance || "No clearance",
          startDate: body.startDate || "",
          closingDate: body.closingDate || "",
          description,
          skills,
          assignedRecruiter: currentUser?.name || "ASJ Recruiter",
          assignedRecruiterId: currentUser?.id || null,
          createdAt: new Date().toISOString()
        };
        db.jobs.push(job);
        refreshJobApplications(db, job);
        db.activities.push({ id: id("act"), message: `${job.title} job created with AI candidate matching.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 201, { job, ...publicState(db) });
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/jobs/")) {
        const jobId = url.pathname.split("/")[3];
        const job = db.jobs.find((item) => item.id === jobId);
        if (!job) return json(res, 404, { error: "Job not found" });
        db.jobs = db.jobs.filter((item) => item.id !== jobId);
        db.applications = db.applications.filter((app) => app.jobId !== jobId);
        db.websiteResumes.forEach((resume) => {
          if (resume.jobId === jobId) resume.jobId = db.jobs.find((item) => item.status === "open")?.id || "";
        });
        db.activities.push({ id: id("act"), message: `${job.title} job deleted from ATS.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { deleted: jobId, ...publicState(db) });
      }

      if ((req.method === "PATCH" || req.method === "PUT" || req.method === "POST") && url.pathname.startsWith("/api/jobs/")) {
        const jobId = url.pathname.split("/")[3];
        const body = await readJson(req);
        const job = db.jobs.find((item) => item.id === jobId);
        if (!job) return json(res, 404, { error: "Job not found" });

        const title = String(body.title || "").trim();
        const description = String(body.description || "").trim();
        if (!title || !description) return json(res, 400, { error: "Job title and description are required" });

        Object.assign(job, {
          title,
          clientId: body.clientId || job.clientId || db.clients[0]?.id,
          status: body.status || job.status || "open",
          location: String(body.location || "Location not set").trim(),
          department: String(body.department || "Recruitment").trim(),
          employmentType: String(body.employmentType || "Full time").trim(),
          priority: body.priority || job.priority || "Medium",
          clearance: body.clearance || job.clearance || "No clearance",
          startDate: body.startDate || job.startDate || "",
          closingDate: body.closingDate || job.closingDate || "",
          description,
          skills: String(body.skills || "")
            .split(",")
            .map((skill) => skill.trim())
            .filter(Boolean),
          updatedAt: new Date().toISOString()
        });

        refreshJobApplications(db, job);
        db.activities.push({ id: id("act"), message: `${job.title} job updated and matches refreshed.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { job, ...publicState(db) });
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/applications/")) {
        const appId = url.pathname.split("/")[3];
        const body = await readJson(req);
        const app = db.applications.find((item) => item.id === appId);
        if (!app) return json(res, 404, { error: "Application not found" });
        if (STAGES.includes(body.stage)) {
          app.stage = body.stage;
          if (body.decision === undefined) {
            delete app.decision;
            delete app.decidedAt;
          }
        }
        if (["Selected", "Rejected"].includes(body.decision)) {
          app.stage = "Final Decision";
          app.decision = body.decision;
          app.decidedAt = new Date().toISOString();
        }
        app.notes = body.notes ?? app.notes;
        const candidate = db.candidates.find((item) => item.id === app.candidateId);
        const job = db.jobs.find((item) => item.id === app.jobId);
        db.activities.push({
          id: id("act"),
          message: `${candidate?.name || "Candidate"} moved to ${app.decision || app.stage}. Job: ${job?.title || "Unknown Job"}. By: ${req.currentUser?.name || "Recruiter"}.`,
          createdAt: new Date().toISOString()
        });
        writeDb(db);
        return json(res, 200, { application: app, ...publicState(db) });
      }

      if (req.method === "DELETE" && /^\/api\/applications\/[^/]+$/.test(url.pathname)) {
        const appId = url.pathname.split("/")[3];
        const app = db.applications.find((item) => item.id === appId);
        if (!app) return json(res, 404, { error: "Pipeline entry not found" });
        const candidate = db.candidates.find((item) => item.id === app.candidateId);
        const job = db.jobs.find((item) => item.id === app.jobId);
        db.applications = db.applications.filter((item) => item.id !== appId);
        db.activities.push({
          id: id("act"),
          message: `${candidate?.name || "Candidate"} removed from pipeline for ${job?.title || "job"}. By: ${req.currentUser?.name || "Recruiter"}.`,
          createdAt: new Date().toISOString()
        });
        writeDb(db);
        return json(res, 200, { deleted: appId, ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/applications") {
        try {
          const body = await readJson(req);
          const app = addCandidateToJob(db, body.candidateId, body.jobId, body.stage || "Applied");
          const candidate = db.candidates.find((item) => item.id === app.candidateId);
          const job = db.jobs.find((item) => item.id === app.jobId);
          db.activities.push({
            id: id("act"),
            message: `${candidate?.name || "Candidate"} added to ${app.stage}. Job: ${job?.title || "Unknown Job"}. By: ${req.currentUser?.name || "Recruiter"}.`,
            createdAt: new Date().toISOString()
          });
          writeDb(db);
          return json(res, 201, { application: app, ...publicState(db) });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }

      // ATS Resume Analysis report for one candidate. Returns the cached report if one
      // exists (computed whenever the candidate's resume is parsed/reparsed -- see
      // refreshAtsReport), or computes it on the fly for older records that predate this
      // feature so nothing shows a blank/broken report just because it's legacy data.
      if (req.method === "GET" && /^\/api\/candidates\/[^/]+\/ats-report$/.test(url.pathname)) {
        const candidateId = url.pathname.split("/")[3];
        const candidate = db.candidates.find((item) => item.id === candidateId);
        if (!candidate) return json(res, 404, { error: "Candidate not found" });
        if (!candidate.atsReport) refreshAtsReport(db, candidate);
        writeDb(db);
        return json(res, 200, { candidateId, report: candidate.atsReport });
      }

      if (req.method === "POST" && /^\/api\/candidates\/[^/]+\/ats-report\/refresh$/.test(url.pathname)) {
        const candidateId = url.pathname.split("/")[4];
        const candidate = db.candidates.find((item) => item.id === candidateId);
        if (!candidate) return json(res, 404, { error: "Candidate not found" });
        refreshAtsReport(db, candidate);
        writeDb(db);
        return json(res, 200, { candidateId, report: candidate.atsReport });
      }

      // Bulk-backfill: analyze every candidate that doesn't have a cached report yet
      // (existing candidates uploaded before this feature shipped won't have one until
      // they're touched again). Only computes for the missing ones, not a full re-run,
      // since re-analyzing everything on every click would be wasteful for a large roster.
      if (req.method === "POST" && url.pathname === "/api/candidates/ats-report/bulk-refresh") {
        const pending = db.candidates.filter((candidate) => !candidate.atsReport);
        pending.forEach((candidate) => refreshAtsReport(db, candidate));
        writeDb(db);
        return json(res, 200, { analyzed: pending.length, ...publicState(db) });
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/candidates/")) {
        const candidateId = url.pathname.split("/")[3];
        const candidate = db.candidates.find((item) => item.id === candidateId);
        if (!candidate) return json(res, 404, { error: "Candidate not found" });
        db.candidates = db.candidates.filter((item) => item.id !== candidateId);
        db.applications = db.applications.filter((item) => item.candidateId !== candidateId);
        db.websiteResumes.forEach((resume) => {
          if (resume.candidateId === candidateId) {
            resume.processed = false;
            delete resume.candidateId;
          }
        });
        db.activities.push({ id: id("act"), message: `${candidate.name} deleted from candidate database.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { deleted: candidateId, ...publicState(db) });
      }

      if ((req.method === "PATCH" || req.method === "PUT") && /^\/api\/candidates\/[^/]+$/.test(url.pathname)) {
        const candidateId = url.pathname.split("/")[3];
        const candidate = db.candidates.find((item) => item.id === candidateId);
        if (!candidate) return json(res, 404, { error: "Candidate not found" });
        const body = await readJson(req);

        // Only accept a fixed set of editable fields -- resumeText/resumeUrl/aiSummary etc.
        // stay server-derived from the parsed resume, not hand-editable here.
        if (body.name !== undefined) {
          const name = String(body.name).trim();
          if (!name) return json(res, 400, { error: "Candidate name cannot be empty" });
          candidate.name = name;
        }
        if (body.email !== undefined) candidate.email = String(body.email).trim();
        if (body.phone !== undefined) candidate.phone = String(body.phone).trim();
        if (body.location !== undefined) candidate.location = String(body.location).trim();
        if (body.currentRole !== undefined) candidate.currentRole = String(body.currentRole).trim();
        if (body.experienceYears !== undefined) {
          const years = Number(body.experienceYears);
          if (!Number.isNaN(years) && years >= 0) candidate.experienceYears = years;
        }
        if (body.openToWork !== undefined) candidate.openToWork = Boolean(body.openToWork);
        if (body.hotList !== undefined) candidate.hotList = Boolean(body.hotList);
        for (const field of ["availability", "currentCompany", "employmentStatus", "noticePeriod"]) {
          if (body[field] !== undefined) candidate[field] = String(body[field] || "").trim().slice(0, 180);
        }
        if (body.status !== undefined) candidate.status = String(body.status).trim();
        if (body.tags !== undefined) {
          candidate.tags = Array.isArray(body.tags)
            ? body.tags.map((tag) => String(tag).trim()).filter(Boolean)
            : String(body.tags).split(",").map((tag) => tag.trim()).filter(Boolean);
        }
        if (body.notes !== undefined) candidate.notes = String(body.notes);
        candidate.updatedAt = new Date().toISOString();

        db.activities.push({
          id: id("act"),
          message: `${candidate.name} profile updated by ${req.currentUser?.name || "a recruiter"}.`,
          createdAt: new Date().toISOString()
        });
        writeDb(db);
        return json(res, 200, { candidate, ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/candidates/bulk-delete") {
        const body = await readJson(req);
        const ids = new Set(body.candidateIds || []);
        const deletedCandidates = db.candidates.filter((candidate) => ids.has(candidate.id));
        const deletedApplications = db.applications.filter((app) => ids.has(app.candidateId));
        const token = id("undo");
        db.deletedCandidates.push({ token, candidates: deletedCandidates, applications: deletedApplications, createdAt: new Date().toISOString() });
        db.candidates = db.candidates.filter((candidate) => !ids.has(candidate.id));
        db.applications = db.applications.filter((app) => !ids.has(app.candidateId));
        db.activities.push({ id: id("act"), message: `${deletedCandidates.length} candidate(s) deleted.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { token, deleted: deletedCandidates.length, ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/candidates/undo-delete") {
        const body = await readJson(req);
        const entry = db.deletedCandidates.find((item) => item.token === body.token);
        if (!entry) return json(res, 404, { error: "Undo window expired." });
        const existing = new Set(db.candidates.map((candidate) => candidate.id));
        db.candidates.push(...entry.candidates.filter((candidate) => !existing.has(candidate.id)));
        db.applications.push(...entry.applications.filter((app) => !db.applications.some((item) => item.id === app.id)));
        db.deletedCandidates = db.deletedCandidates.filter((item) => item.token !== body.token);
        db.activities.push({ id: id("act"), message: `${entry.candidates.length} candidate(s) restored.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { restored: entry.candidates.length, ...publicState(db) });
      }

      // ── Compliance documents ──────────────────────────────────────────
      if (req.method === "POST" && url.pathname === "/api/compliance/documents") {
        try {
          const raw = await readRaw(req);
          const parts = parseMultipart(raw, req.headers["content-type"] || "");
          const fields = Object.fromEntries(parts.filter((part) => !part.filename).map((part) => [part.name, part.body.toString("utf8")]));
          const file = parts.find((part) => part.name === "file" && part.filename);

          const candidate = db.candidates.find((item) => item.id === fields.candidateId);
          if (!candidate) return json(res, 404, { error: "Candidate not found" });
          if (!file) return json(res, 400, { error: "Choose a document file to upload." });
          if (file.body.length > MAX_UPLOAD_BYTES) return json(res, 400, { error: "File is too large. Maximum size is 10MB." });
          const extension = assertAllowedUpload({ buffer: file.body, filename: file.filename, allowedExtensions: ALLOWED_COMPLIANCE_EXTENSIONS, label: "document" });
          const documentType = COMPLIANCE_DOCUMENT_TYPES.includes(fields.type) ? fields.type : "Other";

          const stored = await uploadObject(file.body, file.filename, file.contentType || contentTypeForExtension(extension));

          const doc = {
            id: id("doc"),
            type: documentType,
            fileName: file.filename,
            fileUrl: stored.url,
            storageProvider: USE_SUPABASE_STORAGE ? "supabase" : "local",
            storageKey: stored.storageKey,
            checksumSha256: fileSha256(file.body),
            uploadedAt: new Date().toISOString(),
            uploadedBy: req.currentUser?.name || "Unknown",
            expiryDate: fields.expiryDate || "",
            status: "submitted",
            notes: fields.notes || "",
            timeline: [{ event: "Document Uploaded", at: new Date().toISOString(), by: req.currentUser?.name || "Unknown" }]
          };
          candidate.complianceDocuments.push(doc);
          db.activities.push({ id: id("act"), message: `${documentType} uploaded for ${candidate.name} by ${req.currentUser?.name || "a recruiter"}.`, createdAt: new Date().toISOString() });
          writeDb(db);
          return json(res, 201, { document: doc, ...publicState(db) });
        } catch (error) {
          return json(res, 400, { error: error.message });
        }
      }

      if ((req.method === "PATCH" || req.method === "PUT") && /^\/api\/compliance\/documents\/[^/]+$/.test(url.pathname)) {
        const documentId = url.pathname.split("/")[4];
        const found = findComplianceDocument(db, documentId);
        if (!found) return json(res, 404, { error: "Document not found" });
        const { candidate, doc } = found;
        const body = await readJson(req);
        const actor = req.currentUser?.name || "a recruiter";

        if (body.expiryDate !== undefined) doc.expiryDate = body.expiryDate;
        if (body.notes !== undefined) doc.notes = String(body.notes);
        if (body.status && ["submitted", "verified", "expired", "review_required"].includes(body.status) && body.status !== doc.status) {
          const eventLabel = { verified: "Verified", expired: "Expired", review_required: "Review Required", submitted: "Updated" }[body.status] || "Updated";
          doc.status = body.status;
          doc.verifiedBy = body.status === "verified" ? actor : doc.verifiedBy;
          doc.verifiedAt = body.status === "verified" ? new Date().toISOString() : doc.verifiedAt;
          doc.timeline.push({ event: eventLabel, at: new Date().toISOString(), by: actor });
        } else if (body.expiryDate !== undefined || body.notes !== undefined) {
          doc.timeline.push({ event: "Updated", at: new Date().toISOString(), by: actor });
        }

        db.activities.push({ id: id("act"), message: `${doc.type} for ${candidate.name} marked ${doc.status.replace(/_/g, " ")} by ${actor}.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { document: doc, ...publicState(db) });
      }

      if (req.method === "DELETE" && /^\/api\/compliance\/documents\/[^/]+$/.test(url.pathname)) {
        const documentId = url.pathname.split("/")[4];
        const found = findComplianceDocument(db, documentId);
        if (!found) return json(res, 404, { error: "Document not found" });
        const { candidate, doc } = found;
        candidate.complianceDocuments = candidate.complianceDocuments.filter((item) => item.id !== documentId);
        try {
          const filePath = resolve(UPLOAD_DIR, doc.fileUrl.replace("/uploads/", ""));
          if (filePath.startsWith(UPLOAD_DIR) && existsSync(filePath)) unlinkSync(filePath);
        } catch (error) {
          console.warn(`[compliance] could not remove file for deleted document: ${error.message}`);
        }
        db.activities.push({ id: id("act"), message: `${doc.type} removed for ${candidate.name} by ${req.currentUser?.name || "a recruiter"}.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { deleted: documentId, ...publicState(db) });
      }

      // ── Notifications (separate, computed feed -- see computeNotifications) ──
      if (req.method === "GET" && url.pathname === "/api/notifications") {
        const notifications = computeNotifications(db, currentUser);
        // Role-change alert: the role-change action itself happens in routes/usersRoutes.js
        // (outside this file), so there's no direct hook to fire a notification from the
        // moment it happens. Instead, we detect it here by comparing the role on the
        // authenticated session against the last role we saw for this user -- the first
        // request after an admin changes someone's role, this fires once for that user only.
        const profile = db.userProfiles[currentUser.id] || {};
        if (profile.lastKnownRole && profile.lastKnownRole !== currentUser.role) {
          notifications.unshift({
            id: `role-change:${currentUser.id}:${currentUser.role}:${Date.now()}`,
            category: "system",
            title: "Your role was updated",
            message: `Your access level was changed from ${profile.lastKnownRole} to ${currentUser.role}.`,
            createdAt: new Date().toISOString(),
            targetView: "settings:profile"
          });
        }
        if (profile.lastKnownRole !== currentUser.role) {
          db.userProfiles[currentUser.id] = { ...profile, lastKnownRole: currentUser.role };
          writeDb(db);
        }
        const readIds = db.notificationReads[currentUser.id] || [];
        return json(res, 200, { notifications, readIds });
      }

      if (req.method === "POST" && url.pathname === "/api/notifications/mark-read") {
        const body = await readJson(req);
        const readIds = new Set(db.notificationReads[currentUser.id] || []);
        readIds.add(body.activityId);
        db.notificationReads[currentUser.id] = [...readIds];
        writeDb(db);
        return json(res, 200, { myNotificationReadIds: db.notificationReads[currentUser.id] });
      }

      if (req.method === "POST" && url.pathname === "/api/notifications/mark-all-read") {
        // Mark every *currently computed* notification as read, not the activity log --
        // notifications now have their own ID space (see computeNotifications).
        db.notificationReads[currentUser.id] = computeNotifications(db, currentUser).map((n) => n.id);
        writeDb(db);
        return json(res, 200, { myNotificationReadIds: db.notificationReads[currentUser.id] });
      }

      if (req.method === "POST" && url.pathname === "/api/outreach") {
        const body = await readJson(req);
        const ids = body.candidateIds || [];
        const job = db.jobs.find((item) => item.id === body.jobId);
        const sent = [];
        for (const candidateId of ids) {
          const candidate = db.candidates.find((item) => item.id === candidateId);
          if (!candidate) continue;
          const email = candidateEmail(candidate);
          if (email && !candidate.email) candidate.email = email;
          const subject = personalizeOutreach(body.subject || `Opportunity${job ? `: ${job.title}` : ""}`, candidate, job);
          const message = personalizeOutreach(body.message || `Hi {{name}},\n\nWe found a role that may match your profile${job ? `: ${job.title}` : ""}. Please reply if you are interested.\n\nRegards,\nRecruitment Team`, candidate, job);
          const entry = { id: id("mail"), candidateId, candidateName: candidate.name, email, jobId: job?.id || "", subject, message, status: email ? "queued" : "missing-email", detail: "", createdAt: new Date().toISOString() };
          if (email) {
            try {
              const result = await sendSmtpMail({ to: email, subject, message });
              entry.status = result.status;
              entry.detail = result.detail;
              entry.sentAt = result.status === "sent" ? new Date().toISOString() : "";
            } catch (error) {
              entry.status = "failed";
              entry.detail = error.message.slice(0, 240);
            }
          } else {
            entry.detail = "No email found in candidate profile or resume text.";
          }
          sent.push(entry);
        }
        db.outreachLog.push(...sent);
        const sentCount = sent.filter((item) => item.status === "sent").length;
        const queuedCount = sent.filter((item) => item.status === "queued").length;
        const failedCount = sent.filter((item) => item.status === "failed" || item.status === "missing-email").length;
        db.activities.push({ id: id("act"), message: `${sentCount} outreach email(s) sent, ${queuedCount} queued, ${failedCount} failed/missing.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { sent, data: hydrate(db), dashboard: dashboard(db), recommendations: talentRecommendations(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/outreach-draft") {
        const body = await readJson(req);
        const draft = await outreachDraft(body, db);
        return json(res, 200, draft);
      }

      // ── Follow-ups: schedule a reminder email to go out N days from now ──
      if (req.method === "POST" && url.pathname === "/api/outreach/follow-ups") {
        const body = await readJson(req);
        const ids = body.candidateIds || [];
        const afterDays = Math.max(1, Number(body.afterDays) || 3);
        const job = db.jobs.find((item) => item.id === body.jobId);
        const scheduledFor = new Date(Date.now() + afterDays * 24 * 60 * 60 * 1000).toISOString();
        const created = [];
        for (const candidateId of ids) {
          const candidate = db.candidates.find((item) => item.id === candidateId);
          if (!candidate) continue;
          const subject = personalizeOutreach(body.subject || `Following up${job ? `: ${job.title}` : ""}`, candidate, job);
          const message = personalizeOutreach(body.message || `Hi {{name}},\n\nJust following up on our earlier message${job ? ` about ${job.title}` : ""}. Let us know if you're still interested.\n\nRegards,\nRecruitment Team`, candidate, job);
          const followup = {
            id: id("fu"), candidateId, candidateName: candidate.name, jobId: job?.id || "",
            subject, message, afterDays, scheduledFor, status: "scheduled",
            createdAt: new Date().toISOString(), createdBy: req.currentUser?.name || "Recruiter", sentAt: "", detail: ""
          };
          db.outreachFollowups.push(followup);
          created.push(followup);
        }
        db.activities.push({ id: id("act"), message: `${created.length} follow-up email(s) scheduled for ${afterDays} day(s) from now by ${req.currentUser?.name || "a recruiter"}.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 201, { created, ...publicState(db) });
      }

      if (req.method === "POST" && /^\/api\/outreach\/follow-ups\/[^/]+\/cancel$/.test(url.pathname)) {
        const followupId = url.pathname.split("/")[4];
        const followup = db.outreachFollowups.find((item) => item.id === followupId);
        if (!followup) return json(res, 404, { error: "Follow-up not found" });
        if (followup.status !== "scheduled") return json(res, 400, { error: "Only scheduled follow-ups can be cancelled." });
        followup.status = "cancelled";
        db.activities.push({ id: id("act"), message: `Follow-up to ${followup.candidateName} cancelled by ${req.currentUser?.name || "a recruiter"}.`, createdAt: new Date().toISOString() });
        writeDb(db);
        return json(res, 200, { followup, ...publicState(db) });
      }

      if (req.method === "POST" && url.pathname === "/api/ai-insight") {
        const body = await readJson(req);
        try {
          const text = await cohereInsight(body.prompt || `Give ASJ recruiters one useful hiring insight for the ${body.page || "current"} page.`, db);
          // ownerId scopes this chat to the user who asked it -- ATS Intelligence history
          // is private per-user, never shared across the team (see GET below).
          db.aiChats.push({ id: id("chat"), ownerId: currentUser.id, prompt: body.prompt || "", text, createdAt: new Date().toISOString() });
          writeDb(db);
          return json(res, 200, {
            text,
            chats: db.aiChats.filter((chat) => chat.ownerId === currentUser.id).slice(-20),
            recommendations: talentRecommendations(db)
          });
        } catch (error) {
          return json(res, 502, { error: error.message });
        }
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/api/ai-chats/")) {
        const chatId = url.pathname.split("/")[3];
        const chat = db.aiChats.find((item) => item.id === chatId);
        if (!chat) return json(res, 404, { error: "Chat not found" });
        if (chat.ownerId && chat.ownerId !== currentUser.id) return json(res, 403, { error: "You can only delete your own conversations." });
        db.aiChats = db.aiChats.filter((item) => item.id !== chatId);
        writeDb(db);
        return json(res, 200, {
          deleted: chatId,
          chats: db.aiChats.filter((item) => item.ownerId === currentUser.id).slice(-20),
          data: hydrate(db), dashboard: dashboard(db), recommendations: talentRecommendations(db)
        });
      }

      return json(res, 404, { error: "API route not found" });
    }

    serveStatic(req, res, url);
  } catch (error) {
    console.error("Unhandled request error:", error);
    json(res, 500, { error: "Something went wrong. Please try again." });
  }
}

function startServer(port = PORT) {
  // Without these, a single unexpected rejection anywhere (a background resume-parse
  // call, a scheduled follow-up tick, etc.) would otherwise crash the whole process
  // and take down every logged-in recruiter's session with it.
  process.on("unhandledRejection", (reason) => {
    console.error("Unhandled promise rejection:", reason);
  });
  process.on("uncaughtException", (error) => {
    console.error("Uncaught exception:", error);
  });

  const server = createServer(handleRequest);

  server.once("error", (error) => {
    const canTryNextPort = error.code === "EADDRINUSE" && !process.env.PORT && port < PORT + 10;

    if (canTryNextPort) {
      console.warn(`Port ${port} is already in use. Trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Stop the existing process or start with PORT=${port + 1} npm run dev.`);
    } else if (error.code === "EACCES" || error.code === "EPERM") {
      console.error(`Cannot listen on ${HOST}:${port}. Try a different HOST or PORT, then restart npm run dev.`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    console.log(`ASJ ATS Beta running at http://${HOST}:${port}`);
  });
}

// Scheduled follow-ups are just records with a scheduledFor timestamp -- something has
// to actually check for due ones and send them. There's no separate worker process here,
// so a simple interval on the same process does it. Safe to call repeatedly: it only acts
// on follow-ups still in "scheduled" status, and failures are recorded per-item rather
// than thrown, so one bad email can't block the rest of the batch.
async function processDueFollowups() {
  const db = readDb();
  const due = db.outreachFollowups.filter((item) => item.status === "scheduled" && new Date(item.scheduledFor).getTime() <= Date.now());
  if (!due.length) return;

  for (const followup of due) {
    const candidate = db.candidates.find((item) => item.id === followup.candidateId);
    if (!candidate) {
      followup.status = "failed";
      followup.detail = "Candidate no longer exists.";
      continue;
    }
    const email = candidateEmail(candidate);
    if (!email) {
      followup.status = "failed";
      followup.detail = "No email found in candidate profile or resume text.";
      continue;
    }
    try {
      const result = await sendSmtpMail({ to: email, subject: followup.subject, message: followup.message });
      followup.status = result.status === "sent" ? "sent" : "failed";
      followup.detail = result.detail;
      followup.sentAt = new Date().toISOString();
    } catch (error) {
      followup.status = "failed";
      followup.detail = String(error.message || "Send failed").slice(0, 240);
    }
  }

  const sentCount = due.filter((item) => item.status === "sent").length;
  db.activities.push({ id: id("act"), message: `${sentCount} scheduled follow-up email(s) sent, ${due.length - sentCount} failed.`, createdAt: new Date().toISOString() });
  writeDb(db);
}

setInterval(() => {
  processDueFollowups().catch((error) => console.error("[followups] processing error:", error.message));
}, 60_000);

await initAppStateStore();
startServer();
