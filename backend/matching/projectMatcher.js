import { normalizeSkillList, extractSkillsFromText } from "./skillNormalizer.js";

// Finds the slice of resume text that looks like a "Projects" section, so technology
// mentions there can be weighted as demonstrated hands-on work rather than just treating
// the whole resume as one bag of words. Falls back to the full text if no clear section
// heading is found -- better to over-credit than to score every project-less resume 0.
const SECTION_HEADINGS = ["projects", "project experience", "personal projects", "academic projects", "key projects"];
const NEXT_SECTION_HEADINGS = ["experience", "work experience", "education", "certifications", "skills", "achievements", "publications"];

export function extractProjectsSection(resumeText) {
  const text = String(resumeText || "");
  const lower = text.toLowerCase();
  let start = -1;
  for (const heading of SECTION_HEADINGS) {
    const index = lower.indexOf(heading);
    if (index !== -1 && (start === -1 || index < start)) start = index;
  }
  if (start === -1) return { section: text, found: false };

  let end = text.length;
  for (const heading of NEXT_SECTION_HEADINGS) {
    const index = lower.indexOf(heading, start + 10);
    if (index !== -1 && index < end) end = index;
  }
  return { section: text.slice(start, end), found: true };
}

export function matchProjects(candidate, job) {
  const { section, found } = extractProjectsSection(candidate.resumeText || "");
  const projectSkills = extractSkillsFromText(section);
  const requiredAndPreferred = normalizeSkillList([...(job.skills || [])]);
  const overlap = requiredAndPreferred.filter((skill) => projectSkills.includes(skill));

  // Relevance ratio against what the job actually needs, plus a small flat credit just
  // for having an identifiable projects section at all (shows initiative/practical work
  // beyond a bare skills list), capped so it can't dominate the ratio-based signal.
  const relevanceRatio = requiredAndPreferred.length ? overlap.length / requiredAndPreferred.length : (projectSkills.length ? 0.5 : 0);
  const hasProjectsBonus = found ? 10 : 0;
  const score = Math.min(100, Math.round(relevanceRatio * 90 + hasProjectsBonus));

  return {
    score,
    hasProjectsSection: found,
    technologiesUsed: projectSkills,
    relevantTechnologies: overlap
  };
}
