import { normalizeSkillList, extractSkillsFromText } from "./skillNormalizer.js";

// The existing data model only stores one flat `job.skills` list (no required/preferred
// split in the DB). Rather than inventing new required fields that would break every job
// already entered, we treat `job.skills` as the Required list (that's what a recruiter
// meant when they typed skills into "Skills Required" on the job form), and derive a
// Preferred list by scanning the job description for additional known technologies that
// aren't already in the required list. This keeps the model backward-compatible while
// still giving the weighted formula a real required/preferred distinction to work with.
export function deriveJobSkillTiers(job) {
  const required = normalizeSkillList(job.skills || []);
  const requiredSet = new Set(required);
  const mentionedInDescription = extractSkillsFromText(job.description || "");
  const preferred = mentionedInDescription.filter((skill) => !requiredSet.has(skill));
  return { required, preferred };
}

function matchTier(candidateSkillSet, tierSkills) {
  if (!tierSkills.length) return { matched: [], missing: [], ratio: 1 }; // nothing asked for => full credit, doesn't drag the score down
  const matched = tierSkills.filter((skill) => candidateSkillSet.has(skill));
  const missing = tierSkills.filter((skill) => !candidateSkillSet.has(skill));
  return { matched, missing, ratio: matched.length / tierSkills.length };
}

// Returns 0-100 scores for the required and preferred tiers independently, plus the
// matched/missing lists the explanation generator needs. Missing REQUIRED skills matter
// far more than missing preferred ones -- that's enforced by the score aggregator giving
// required 30% weight vs preferred's 10%, not by anything in here, so this module just
// reports the plain match ratios honestly.
export function matchSkills(candidate, job) {
  const candidateSkills = normalizeSkillList([
    ...(candidate.skills || []),
    ...extractSkillsFromText(candidate.resumeText || "")
  ]);
  const candidateSkillSet = new Set(candidateSkills);
  const { required, preferred } = deriveJobSkillTiers(job);

  const requiredMatch = matchTier(candidateSkillSet, required);
  const preferredMatch = matchTier(candidateSkillSet, preferred);

  return {
    requiredScore: Math.round(requiredMatch.ratio * 100),
    preferredScore: Math.round(preferredMatch.ratio * 100),
    requiredSkills: required,
    preferredSkills: preferred,
    matchedRequired: requiredMatch.matched,
    missingRequired: requiredMatch.missing,
    matchedPreferred: preferredMatch.matched,
    missingPreferred: preferredMatch.missing,
    candidateSkills
  };
}
