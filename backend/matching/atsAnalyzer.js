// ATS Resume Analyzer
//
// Builds a full ATS-style report for a single candidate/resume. Rather than inventing a
// second scoring system from scratch, this reuses the same matcher modules that already
// power job-match scoring (skillMatcher, educationMatcher, experienceMatcher,
// projectMatcher, certificationMatcher, resumeQuality) and adds the pieces that are
// specific to a general "how ATS-ready is this resume" report rather than a
// candidate-vs-job comparison: keyword coverage against a broad tech dictionary,
// readability, section-completeness, red flags, and priority-ranked recommendations.
//
// Everything here is computed from the actual resume text and candidate record --
// there is no fabricated or placeholder scoring. When there's no open job to compare
// against, the job-relevance-dependent metrics degrease gracefully (reported as
// "not available" rather than a fake number).

import { matchSkills } from "./skillMatcher.js";
import { matchEducation } from "./educationMatcher.js";
import { matchExperience } from "./experienceMatcher.js";
import { matchProjects } from "./projectMatcher.js";
import { matchCertifications } from "./certificationMatcher.js";
import { scoreResumeQuality } from "./resumeQuality.js";
import { extractSkillsFromText } from "./skillNormalizer.js";

// A broad, role-agnostic set of in-demand technical/professional keywords used for the
// job-independent "Keyword Coverage" metric. This intentionally overlaps with (but is
// broader than) the skill dictionary used for job matching, since ATS keyword coverage
// in the real world also cares about domain/process terms, not just tool names.
const ATS_KEYWORD_BANK = [
  "javascript", "typescript", "python", "java", "react", "node.js", "sql", "aws", "azure",
  "docker", "kubernetes", "ci/cd", "agile", "scrum", "rest api", "microservices", "git",
  "machine learning", "data analysis", "cloud", "devops", "testing", "automation",
  "leadership", "communication", "project management", "stakeholder management",
  "problem solving", "cross-functional", "mentoring", "collaboration"
];

const ACTION_VERBS = [
  "led", "built", "designed", "developed", "implemented", "launched", "managed", "created",
  "improved", "increased", "reduced", "optimized", "delivered", "drove", "architected",
  "spearheaded", "streamlined", "automated", "mentored", "coordinated", "negotiated",
  "resolved", "established", "executed", "scaled", "migrated", "owned", "shipped"
];

const RESUME_SECTIONS = [
  { key: "summary", label: "Professional Summary", patterns: [/professional summary/i, /^summary/im, /career objective/i, /profile\b/i] },
  { key: "experience", label: "Work Experience", patterns: [/experience/i, /employment history/i, /work history/i] },
  { key: "education", label: "Education", patterns: [/education/i, /academic/i] },
  { key: "skills", label: "Skills", patterns: [/skills/i, /technical proficienc/i, /core competenc/i] },
  { key: "projects", label: "Projects", patterns: [/projects?\b/i] },
  { key: "certifications", label: "Certifications", patterns: [/certification/i, /licensed?\b/i] },
  { key: "soft_skills", label: "Soft Skills", patterns: [/soft skills/i, /interpersonal/i] },
  { key: "leadership", label: "Leadership", patterns: [/leadership/i, /led a team/i, /managed a team/i] },
  { key: "achievements", label: "Achievements", patterns: [/achievements?/i, /accomplishments?/i, /awards?/i] }
];

function ratingForScore(score) {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Average";
  return "Poor";
}

function detectSections(text) {
  const found = [];
  const missing = [];
  for (const section of RESUME_SECTIONS) {
    const hit = section.patterns.some((pattern) => pattern.test(text));
    (hit ? found : missing).push(section.label);
  }
  return { found, missing };
}

function keywordCoverage(text, candidateSkills) {
  const lower = text.toLowerCase();
  const combined = new Set([...(candidateSkills || []).map((s) => s.toLowerCase()), ...extractSkillsFromText(text)]);
  const matched = ATS_KEYWORD_BANK.filter((keyword) => lower.includes(keyword) || combined.has(keyword));
  const missing = ATS_KEYWORD_BANK.filter((keyword) => !matched.includes(keyword));
  const score = Math.round((matched.length / ATS_KEYWORD_BANK.length) * 100);
  return { score, matched, missing: missing.slice(0, 12) };
}

// Simple, transparent readability heuristic (not a Flesch-Kincaid implementation):
// rewards resumes written in short, scannable bullet-style lines rather than dense
// paragraphs, since that's what actually matters for a human recruiter skimming a resume
// (and for ATS parsers, which handle bulleted, short lines far more reliably than prose).
function readability(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { score: 0, avgLineLength: 0, bulletRatio: 0 };
  const avgLineLength = Math.round(lines.reduce((sum, l) => sum + l.length, 0) / lines.length);
  const bulletLines = lines.filter((l) => /^[•\-*▪◦]/.test(l)).length;
  const bulletRatio = bulletLines / lines.length;
  let score = 100;
  if (avgLineLength > 160) score -= 30;
  else if (avgLineLength > 110) score -= 15;
  if (bulletRatio < 0.15) score -= 20; // mostly paragraph-style, not scannable
  const words = text.split(/\s+/).filter(Boolean);
  const longWordRatio = words.length ? words.filter((w) => w.length > 12).length / words.length : 0;
  if (longWordRatio > 0.08) score -= 10; // dense jargon/run-on compound terms
  return { score: Math.max(0, Math.min(100, score)), avgLineLength, bulletRatio: Math.round(bulletRatio * 100) };
}

function quantifiableAchievements(text) {
  // Looks for bullet-style lines that contain a number, percent, or currency figure --
  // the standard signal of a results-oriented ("increased X by 30%") vs task-oriented
  // ("responsible for X") bullet.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletLines = lines.filter((l) => /^[•\-*▪◦]/.test(l) || l.length < 200);
  const quantified = bulletLines.filter((l) => /\d+(\.\d+)?\s*%|\$\s?\d|\b\d{2,}\+?\b/.test(l));
  return { bulletCount: bulletLines.length, quantifiedCount: quantified.length };
}

function actionVerbUsage(text) {
  const lower = text.toLowerCase();
  const found = ACTION_VERBS.filter((verb) => new RegExp(`\\b${verb}\\b`).test(lower));
  return { count: found.length, verbs: found.slice(0, 10) };
}

function detectRedFlags(candidate, text, experienceYears) {
  const flags = [];
  const lower = text.toLowerCase();
  if (text.trim().length < 400) flags.push("Resume content is very short -- may be missing sections or poorly parsed.");
  if (!candidate.email) flags.push("No email address found on the resume.");
  if (!(candidate.skills || []).length) flags.push("No skills could be identified.");
  if (!experienceYears) flags.push("No clear work experience duration could be determined.");
  // Crude duplicate-content check: a resume with the same non-trivial line repeated 3+
  // times usually indicates a copy-paste or extraction error, not intentional content.
  const lineCounts = new Map();
  text.split("\n").map((l) => l.trim()).filter((l) => l.length > 25).forEach((l) => {
    lineCounts.set(l, (lineCounts.get(l) || 0) + 1);
  });
  if ([...lineCounts.values()].some((count) => count >= 3)) flags.push("Duplicate content detected -- some lines repeat multiple times.");
  const alnumRatio = text.length ? (text.replace(/[^a-zA-Z0-9\s]/g, "").length / text.length) : 1;
  if (text.length > 50 && alnumRatio < 0.85) flags.push("Formatting looks inconsistent -- extraction may have introduced artifacts.");
  if (/\b(19|20)\d{2}\b.{0,40}\b(19|20)\d{2}\b/.test(lower)) {
    const years = [...lower.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])).sort((a, b) => a - b);
    for (let i = 1; i < years.length; i++) {
      if (years[i] - years[i - 1] >= 2) { flags.push(`Possible employment gap around ${years[i - 1]}-${years[i]}.`); break; }
    }
  }
  return flags;
}

function suggestedImprovements({ sectionGaps, keywordGaps, quantified, actionVerbs, readabilityScore }) {
  const suggestions = [];
  if (sectionGaps.includes("Professional Summary")) suggestions.push("Add a 2-3 sentence professional summary at the top highlighting your target role and years of experience.");
  if (sectionGaps.includes("Projects")) suggestions.push("Add a Projects section with 2-3 concrete examples, including tools used and measurable outcomes.");
  if (sectionGaps.includes("Certifications")) suggestions.push("List any relevant certifications, even in-progress ones, in a dedicated Certifications section.");
  if (sectionGaps.includes("Achievements")) suggestions.push("Add an Achievements section calling out awards, recognitions, or standout results.");
  if (keywordGaps.length) suggestions.push(`Work in more role-relevant keywords such as: ${keywordGaps.slice(0, 6).join(", ")}.`);
  if (quantified.bulletCount && quantified.quantifiedCount / quantified.bulletCount < 0.3) suggestions.push("Quantify more bullet points with numbers, percentages, or dollar impact (e.g. \"reduced load time by 40%\").");
  if (actionVerbs.count < 5) suggestions.push("Start more bullet points with strong action verbs (e.g. \"led\", \"built\", \"optimized\") instead of passive phrases.");
  if (readabilityScore < 60) suggestions.push("Break up long paragraphs into short, scannable bullet points.");
  return suggestions;
}

function priorityRecommendations(report) {
  // Highest-impact, lowest-effort fixes first. Each item carries an explicit priority
  // tier so the UI can rank them without re-deriving the logic.
  const items = [];
  if (report.breakdown.keywordCoverage < 50) items.push({ priority: "High", text: "Keyword coverage is low -- add more of the missing keywords listed above." });
  if (report.missingSections.includes("Professional Summary")) items.push({ priority: "High", text: "Add a professional summary -- this is usually the first thing both ATS parsers and recruiters look for." });
  if (report.redFlags.length) items.push({ priority: "High", text: "Resolve the red flags listed below before submitting this resume." });
  if (report.breakdown.readability < 60) items.push({ priority: "Medium", text: "Improve formatting/readability with shorter, bulleted lines." });
  if (report.resumeQualitySignals.quantifiedRatio < 30) items.push({ priority: "Medium", text: "Add measurable outcomes to more bullet points." });
  if (report.missingSections.includes("Projects")) items.push({ priority: "Medium", text: "Add a Projects section to demonstrate applied skills." });
  if (report.breakdown.certifications < 20) items.push({ priority: "Low", text: "Consider adding relevant certifications to strengthen credibility." });
  if (!items.length) items.push({ priority: "Low", text: "This resume is in strong shape -- only minor polish suggested." });
  return items;
}

// Local, deterministic AI-rewrite suggestions. These are template-based rather than a
// live LLM call so bulk analysis (dozens of resumes at once) doesn't require dozens of
// external API calls; the wording is generated from the candidate's own actual data
// (role, top skills) rather than being generic filler.
function rewriteSuggestions(candidate, report) {
  const role = candidate.currentRole || "the target role";
  const topSkills = (candidate.skills || []).slice(0, 4);
  const skillPhrase = topSkills.length ? topSkills.join(", ") : "your core technical skills";
  return {
    professionalSummary: `${candidate.experienceYears ? `${candidate.experienceYears}+ years experienced` : "Experienced"} ${role} with hands-on expertise in ${skillPhrase}. Proven track record of delivering measurable results and collaborating cross-functionally to ship impactful work.`,
    bulletPointExample: `Led [project/initiative], resulting in [quantified outcome, e.g. "a 25% reduction in processing time"] by applying ${topSkills[0] || "relevant technical skills"}.`,
    missingKeywordsToAdd: report.missingKeywords.matched ? [] : report.missingKeywords.missing.slice(0, 8),
    suggestedSkillsToAdd: report.missingKeywords.missing.filter((k) => !/management|communication|leadership/i.test(k)).slice(0, 6),
    projectDescriptionExample: `[Project Name]: Built a [type of solution] using ${skillPhrase || "relevant tools"}, improving [specific metric] by [X%]. Collaborated with a team of [N] to deliver on schedule.`
  };
}

export function analyzeResume(candidate, job = null) {
  const text = String(candidate.resumeText || "");
  const skillsResult = job ? matchSkills(candidate, job) : null;
  const educationResult = job ? matchEducation(candidate, job) : null;
  const experienceResult = job ? matchExperience(candidate, job) : null;
  const projectsResult = job ? matchProjects(candidate, job) : null;
  const certResult = matchCertifications(candidate);
  const qualityResult = scoreResumeQuality(candidate);
  const { found: foundSections, missing: missingSections } = detectSections(text);
  const keywords = keywordCoverage(text, candidate.skills);
  const read = readability(text);
  const quant = quantifiableAchievements(text);
  const verbs = actionVerbUsage(text);
  const quantifiedRatio = quant.bulletCount ? Math.round((quant.quantifiedCount / quant.bulletCount) * 100) : 0;

  const completeness = Math.round((foundSections.length / RESUME_SECTIONS.length) * 100);

  const breakdown = {
    skills: skillsResult ? Math.round((skillsResult.requiredScore * 0.75) + (skillsResult.preferredScore * 0.25)) : null,
    experience: experienceResult ? experienceResult.score : null,
    education: educationResult ? educationResult.score : null,
    projects: projectsResult ? projectsResult.score : null,
    certifications: certResult.score,
    resumeStructure: completeness,
    readability: read.score,
    keywordCoverage: keywords.score
  };

  const scorable = Object.values(breakdown).filter((v) => typeof v === "number");
  const overallScore = scorable.length ? Math.round(scorable.reduce((sum, v) => sum + v, 0) / scorable.length) : 0;
  // Resume Strength is a slightly different composite from the overall ATS score -- it
  // weighs the "is this resume well put together" signals (quality, structure,
  // readability, verbs/quantification) rather than job-fit, since a resume can be
  // strong on its own merits even without a specific job to compare it to.
  const resumeStrength = Math.round(
    (qualityResult.score * 0.3) + (completeness * 0.25) + (read.score * 0.2) +
    (Math.min(100, verbs.count * 10) * 0.15) + (Math.min(100, quantifiedRatio) * 0.1)
  );

  const report = {
    generatedAt: new Date().toISOString(),
    atsScore: overallScore,
    rating: ratingForScore(overallScore),
    breakdown,
    resumeStrength,
    strengths: [],
    weaknesses: [],
    missingKeywords: keywords,
    missingSections,
    foundSections,
    resumeQualitySignals: {
      bulletCount: quant.bulletCount,
      quantifiedCount: quant.quantifiedCount,
      quantifiedRatio,
      actionVerbCount: verbs.count,
      actionVerbsFound: verbs.verbs,
      resumeLength: text.trim().length,
      avgLineLength: read.avgLineLength,
      bulletRatio: read.bulletRatio,
      formattingReasons: qualityResult.reasons
    },
    redFlags: detectRedFlags(candidate, text, candidate.experienceYears),
    jobContext: job ? { jobId: job.id, jobTitle: job.title } : null
  };

  // Strengths/weaknesses summary, derived from the breakdown itself (kept honest --
  // no canned text unrelated to the actual scores).
  if (breakdown.skills !== null && breakdown.skills >= 70) report.strengths.push("Strong alignment with the target role's required skills.");
  if (breakdown.keywordCoverage >= 60) report.strengths.push("Good keyword coverage for ATS parsers.");
  if (report.resumeQualitySignals.actionVerbCount >= 8) report.strengths.push("Strong use of action verbs throughout.");
  if (quantifiedRatio >= 40) report.strengths.push("Multiple bullet points include quantifiable results.");
  if (certResult.score >= 40) report.strengths.push("Relevant certifications on file.");
  if (!report.strengths.length) report.strengths.push("Resume was successfully parsed; see recommendations below to strengthen it further.");

  if (missingSections.length) report.weaknesses.push(`Missing sections: ${missingSections.join(", ")}.`);
  if (breakdown.keywordCoverage < 50) report.weaknesses.push("Keyword coverage is below average for ATS parsers.");
  if (quantifiedRatio < 25 && quant.bulletCount > 0) report.weaknesses.push("Few bullet points include measurable outcomes.");
  if (verbs.count < 5) report.weaknesses.push("Limited use of strong action verbs.");
  if (!report.weaknesses.length) report.weaknesses.push("No significant weaknesses detected.");

  report.priorityRecommendations = priorityRecommendations(report);
  report.suggestedImprovements = suggestedImprovements({
    sectionGaps: missingSections, keywordGaps: keywords.missing, quantified: quant, actionVerbs: verbs, readabilityScore: read.score
  });
  report.aiRewriteSuggestions = rewriteSuggestions(candidate, report);

  return report;
}
