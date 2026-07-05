// One-off migration: re-extract `skills` for every existing candidate (and websiteResumes
// snapshot, if present) using the corrected, text-verified extraction logic now in server.js.
// Run once with: node backend/migrate-skills.mjs
//
// Why this is needed: candidates parsed before the verifyAiSkillAgainstText / false-positive
// guard existed may have skills the AI hallucinated (e.g. "REST", "SQL" inferred from a
// "DBMS project" mention) or skills false-matched from non-technical context (e.g. "AWS" from
// "AWS Academy", "Healthcare" from "Rural Healthcare" project name). The parsing code that
// creates *new* candidates is already correct — this script brings existing data in line with it.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DB_FILE = process.env.DB_FILE ? resolve(process.env.DB_FILE) : resolve(import.meta.dirname, "..", "data", "db.json");

// ── Verbatim copy of the extraction logic from server.js (kept in sync manually) ──
const KNOWN_SKILLS = [
  "React", "JavaScript", "TypeScript", "Node.js", "Express", "REST", "GraphQL", "PostgreSQL", "MongoDB",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "CI/CD", "Jenkins", "Python", "Django",
  "SQL", "MySQL", "Power BI", "Tableau", "Data Analysis", "Healthcare", "Security", "Monitoring", "Agile", "Accessibility",
  "Machine Learning", "Artificial Intelligence", "AI", "ML", "Deep Learning", "TensorFlow", "Keras", "Scikit-learn",
  "Pandas", "NumPy", "Matplotlib", "OpenCV", "Computer Vision", "NLP", "FastAPI", "Figma", "UI/UX", "IoT",
  "MediaPipe", "Vosk", "Twilio", "SMTP", "GitHub", "C", "Java", "Spring Boot", "Kafka", "MLOps"
];

const SKILL_FALSE_POSITIVE_CONTEXT = {
  AWS: [/\baws academy\b/i],
  Healthcare: [/\brural healthcare\b/i, /\bhealthcare (?:solution|platform|sector|industry)\b/i],
  AI: [/\bai voice assistant\b/i],
  Security: [/\bsocial security\b/i, /\bjob security\b/i],
  ML: []
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function skillPattern(skill) {
  const escaped = escapeRegExp(skill);
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
}
const SKILL_PATTERNS = new Map(KNOWN_SKILLS.map((skill) => [skill, skillPattern(skill)]));

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

function verifyAiSkillAgainstText(skill, normalizedText) {
  const trimmed = String(skill || "").trim();
  if (!trimmed) return false;
  const known = KNOWN_SKILLS.find((entry) => entry.toLowerCase() === trimmed.toLowerCase());
  if (known) return SKILL_PATTERNS.get(known).test(normalizedText) && !isSkillFalsePositive(known, normalizedText);
  const escaped = escapeRegExp(trimmed);
  const adHocPattern = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
  return adHocPattern.test(normalizedText);
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function recomputeSkills(existingSkills, resumeText) {
  const text = String(resumeText || "").replace(/\s+/g, " ").trim();
  if (!text) return existingSkills || [];
  // Treat the candidate's current skills as "AI-suggested" and re-verify each one against the
  // actual resume text, then union with a fresh keyword scan — same rule the live parser uses.
  const verified = (existingSkills || []).filter((skill) => verifyAiSkillAgainstText(skill, text));
  return uniq([...verified, ...extractSkills(text)]).slice(0, 18);
}

// ── Run the migration ──
const db = JSON.parse(readFileSync(DB_FILE, "utf8"));
let changedCandidates = 0;
const report = [];

for (const candidate of db.candidates || []) {
  const before = candidate.skills || [];
  const after = recomputeSkills(before, candidate.resumeText);
  const removed = before.filter((s) => !after.includes(s));
  const added = after.filter((s) => !before.includes(s));
  if (removed.length || added.length) {
    changedCandidates += 1;
    report.push({ name: candidate.name, id: candidate.id, removed, added });
    candidate.skills = after;
    // Keep the AI summary's skill mention roughly in sync too, since it's often shown alongside skills.
    if (candidate.aiSummary && removed.length) {
      candidate.skillsRecomputedAt = new Date().toISOString();
    }
  }
}

let changedResumes = 0;
for (const resume of db.websiteResumes || []) {
  if (!Array.isArray(resume.skills)) continue;
  const before = resume.skills;
  const after = recomputeSkills(before, resume.resumeText);
  if (after.join("|") !== before.join("|")) {
    changedResumes += 1;
    resume.skills = after;
  }
}

writeFileSync(DB_FILE, `${JSON.stringify(db, null, 2)}\n`);

console.log(`Re-checked ${db.candidates?.length || 0} candidates, ${db.websiteResumes?.length || 0} resumes.`);
console.log(`Updated skills for ${changedCandidates} candidate(s) and ${changedResumes} resume record(s).`);
console.log();
for (const entry of report) {
  console.log(`- ${entry.name} (${entry.id})`);
  if (entry.removed.length) console.log(`    removed: ${entry.removed.join(", ")}`);
  if (entry.added.length) console.log(`    added:   ${entry.added.join(", ")}`);
}
