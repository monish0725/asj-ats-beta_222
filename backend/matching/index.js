import { matchSkills } from "./skillMatcher.js";
import { matchEducation } from "./educationMatcher.js";
import { matchExperience } from "./experienceMatcher.js";
import { matchProjects } from "./projectMatcher.js";
import { matchCertifications } from "./certificationMatcher.js";
import { matchRoleSimilarity } from "./roleSimilarity.js";
import { scoreResumeQuality } from "./resumeQuality.js";
import { matchSemantic } from "./semanticMatcher.js";
import { aggregateScore } from "./scoreAggregator.js";
import { generateExplanation } from "./explanationGenerator.js";

// Runs every matcher module for one candidate/job pair and returns both the full
// explainable breakdown and a backward-compatible shape so existing call sites
// (pipeline stage assignment, dashboard averages, etc.) don't need to change.
// `weightOverrides`, when provided (from AI Settings), is passed straight through to
// aggregateScore; omitting it preserves the original spec weights exactly as before.
export async function matchCandidateToJob(candidate, job, weightOverrides) {
  const skills = matchSkills(candidate, job);
  const education = matchEducation(candidate, job);
  const experience = matchExperience(candidate, job);
  const projects = matchProjects(candidate, job);
  const certifications = matchCertifications(candidate);
  const roleSimilarity = matchRoleSimilarity(candidate, job);
  const resumeQuality = scoreResumeQuality(candidate);
  const semantic = await matchSemantic(candidate, job);

  const aggregate = aggregateScore({ skills, education, experience, projects, certifications, roleSimilarity, resumeQuality, semantic }, weightOverrides);
  const explanation = generateExplanation({ candidate, job, skills, education, experience, projects, certifications, roleSimilarity, resumeQuality, semantic, aggregate });

  return {
    // Backward-compatible fields used throughout the existing codebase
    matchScore: aggregate.overall,
    matchedSkills: explanation.matchedSkills,
    skillGaps: explanation.missingSkills,
    recommendation: explanation.recommendation,
    // Full explainable breakdown for anywhere that wants to show the detail
    breakdown: explanation
  };
}

// Synchronous variant for call sites that can't await (there are a few hot loops in the
// existing dashboard/pipeline code). Semantic matching is always "unavailable" here since
// it requires a network call -- everything else runs exactly as the async version.
export function matchCandidateToJobSync(candidate, job, weightOverrides) {
  const skills = matchSkills(candidate, job);
  const education = matchEducation(candidate, job);
  const experience = matchExperience(candidate, job);
  const projects = matchProjects(candidate, job);
  const certifications = matchCertifications(candidate);
  const roleSimilarity = matchRoleSimilarity(candidate, job);
  const resumeQuality = scoreResumeQuality(candidate);
  const semantic = { score: null, status: "unavailable", reason: "Synchronous scoring path does not call the embeddings API." };

  const aggregate = aggregateScore({ skills, education, experience, projects, certifications, roleSimilarity, resumeQuality, semantic }, weightOverrides);
  const explanation = generateExplanation({ candidate, job, skills, education, experience, projects, certifications, roleSimilarity, resumeQuality, semantic, aggregate });

  return {
    matchScore: aggregate.overall,
    matchedSkills: explanation.matchedSkills,
    skillGaps: explanation.missingSkills,
    recommendation: explanation.recommendation,
    breakdown: explanation
  };
}

// Ranks a list of {candidate, job, ...matchResult} entries per the spec: Overall Score
// first, then Required Skill Match, then Experience relevance, then Education match --
// each as a tiebreaker for the one before it, not an independent sort key.
export function rankMatches(matches) {
  return [...matches].sort((a, b) => {
    if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
    const aRequired = a.breakdown.componentScores.requiredSkills;
    const bRequired = b.breakdown.componentScores.requiredSkills;
    if (bRequired !== aRequired) return bRequired - aRequired;
    const aExperience = a.breakdown.componentScores.experience;
    const bExperience = b.breakdown.componentScores.experience;
    if (bExperience !== aExperience) return bExperience - aExperience;
    return b.breakdown.componentScores.education - a.breakdown.componentScores.education;
  });
}
