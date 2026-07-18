import { normalizeSkillList, extractSkillsFromText } from "./skillNormalizer.js";

// Infers the seniority the job is looking for from its title, since the data model
// doesn't have a dedicated seniority field. Used only to judge whether the candidate's
// years are in the right ballpark -- not as the whole score.
function inferExpectedYears(job) {
  const title = String(job?.title || "").toLowerCase();
  if (/principal|staff|architect/.test(title)) return { min: 9, ideal: 12 };
  if (/senior|lead|sr\.?\b/.test(title)) return { min: 5, ideal: 7 };
  if (/junior|jr\.?\b|graduate|entry/.test(title)) return { min: 0, ideal: 1.5 };
  return { min: 2, ideal: 4 }; // mid-level default
}

// Years score: full credit once the candidate meets the role's "ideal" years, partial
// credit approaching it, and doesn't crater to zero for being under -- a strong junior
// candidate for a mid-level role still has a real, if imperfect, years fit.
function scoreYears(experienceYears, expected) {
  const years = Number(experienceYears) || 0;
  if (years >= expected.ideal) return 100;
  if (years >= expected.min) return Math.round(60 + ((years - expected.min) / Math.max(expected.ideal - expected.min, 0.1)) * 40);
  if (expected.min === 0) return 100; // entry-level role, junior years are exactly right
  return Math.round((years / expected.min) * 60);
}

// Role relevance: does the candidate's current/most recent role title and resume text
// actually talk about the same kind of work as the job title, beyond just shared skills.
function scoreRoleRelevance(candidate, job) {
  const jobTokens = new Set(String(job?.title || "").toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 2));
  const candidateTokens = new Set(String(candidate?.currentRole || "").toLowerCase().split(/[^a-z0-9+#.]+/).filter((token) => token.length > 2));
  if (!jobTokens.size || !candidateTokens.size) return 50; // no signal either way, stay neutral
  const overlap = [...jobTokens].filter((token) => candidateTokens.has(token));
  const genericWords = new Set(["senior", "junior", "engineer", "developer", "specialist", "lead"]);
  const meaningfulOverlap = overlap.filter((token) => !genericWords.has(token));
  if (meaningfulOverlap.length) return 100;
  if (overlap.length) return 65; // shared seniority/role word but not the domain itself
  return 30;
}

// Technology-usage relevance: of the skills the job actually asks for, how many did the
// candidate's resume text describe using in the context of real work (not just a bare
// skills list) -- approximated here as "mentioned anywhere in the full resume text",
// which in practice captures experience-section usage since that's most of a resume.
function scoreTechnologyUsage(candidate, job) {
  const required = normalizeSkillList(job.skills || []);
  if (!required.length) return 70; // no required skills listed, can't penalize on this axis
  const usedInText = new Set(extractSkillsFromText(candidate.resumeText || ""));
  const listedSkills = new Set(normalizeSkillList(candidate.skills || []));
  const used = required.filter((skill) => usedInText.has(skill) || listedSkills.has(skill));
  return Math.round((used.length / required.length) * 100);
}

export function matchExperience(candidate, job) {
  const expected = inferExpectedYears(job);
  const yearsScore = scoreYears(candidate.experienceYears, expected);
  const roleScore = scoreRoleRelevance(candidate, job);
  const techScore = scoreTechnologyUsage(candidate, job);
  // Blended, not years-only: years is the biggest single factor but role relevance and
  // real technology usage together outweigh it, which is the whole point of this module.
  const score = Math.round(yearsScore * 0.4 + roleScore * 0.3 + techScore * 0.3);
  return {
    score,
    yearsScore,
    roleScore,
    techScore,
    candidateYears: Number(candidate.experienceYears) || 0,
    expectedYears: expected
  };
}
