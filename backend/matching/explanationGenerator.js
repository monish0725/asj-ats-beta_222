function recommendationFor(overall, missingRequiredCount) {
  if (overall >= 85 && missingRequiredCount === 0) return "Top Candidate — strong match, recommend for interview";
  if (overall >= 70) return "Eligible — solid match, worth reviewing";
  if (overall >= 55) return "Possible Fit — has potential but has real gaps to probe in screening";
  return "Not Recommended — significant gaps against this role's requirements";
}

function buildStrengths({ skills, education, experience, projects, certifications, roleSimilarity }) {
  const strengths = [];
  if (skills.requiredScore >= 80) strengths.push(`Strong match on required skills (${skills.matchedRequired.length}/${skills.requiredSkills.length})`);
  if (education.score >= 80) strengths.push(`Education closely aligned with the role (${education.detectedField || "relevant field"})`);
  if (experience.yearsScore >= 80) strengths.push(`Experience level fits the role well (${experience.candidateYears} years)`);
  if (experience.techScore >= 75) strengths.push("Demonstrated hands-on use of the required technologies");
  if (projects.relevantTechnologies.length) strengths.push(`Relevant project experience with ${projects.relevantTechnologies.slice(0, 3).join(", ")}`);
  if (certifications.certifications.length) strengths.push(`Holds relevant certifications: ${certifications.certifications.join(", ")}`);
  if (roleSimilarity.matched) strengths.push("Career history is a close match for this role category");
  return strengths;
}

function buildWeaknesses({ skills, education, experience, projects, certifications, resumeQuality }) {
  const weaknesses = [];
  if (skills.missingRequired.length) weaknesses.push(`Missing required skills: ${skills.missingRequired.join(", ")}`);
  if (education.score < 50) weaknesses.push("Education background isn't closely aligned with this role");
  if (experience.yearsScore < 50) weaknesses.push(`Experience (${experience.candidateYears} yrs) is below what this role typically expects`);
  if (!projects.hasProjectsSection) weaknesses.push("No clear projects section found to verify hands-on experience");
  if (!certifications.certifications.length) weaknesses.push("No relevant certifications listed");
  if (resumeQuality.score < 50) weaknesses.push("Resume is thin on detail, which limits how confidently this score can be trusted");
  return weaknesses;
}

// Assembles the full explainable breakdown the spec asks for: overall %, matched/missing
// skills, education/experience/project/certification match detail, strengths, weaknesses,
// and a final plain-language recommendation. This is what the UI renders for a recruiter
// and what candidates can be ranked/sorted on beyond just the overall number.
export function generateExplanation({ candidate, job, skills, education, experience, projects, certifications, roleSimilarity, resumeQuality, semantic, aggregate }) {
  return {
    candidateId: candidate.id,
    candidateName: candidate.name,
    jobId: job.id,
    jobTitle: job.title,
    overallMatch: aggregate.overall,
    matchedSkills: [...skills.matchedRequired, ...skills.matchedPreferred],
    missingSkills: skills.missingRequired,
    missingPreferredSkills: skills.missingPreferred,
    educationMatch: { score: education.score, field: education.detectedField, roleFamily: education.roleFamily },
    experienceMatch: { score: experience.score, years: experience.candidateYears, yearsScore: experience.yearsScore, roleScore: experience.roleScore, techScore: experience.techScore },
    projectMatch: { score: projects.score, relevantTechnologies: projects.relevantTechnologies, hasProjectsSection: projects.hasProjectsSection },
    certificationMatch: { score: certifications.score, certifications: certifications.certifications },
    roleSimilarity: { score: roleSimilarity.score, matched: roleSimilarity.matched },
    resumeQuality: { score: resumeQuality.score, notes: resumeQuality.reasons },
    semantic: { score: semantic.score, status: semantic.status, reason: semantic.reason || null },
    componentScores: aggregate.components,
    weightsUsed: aggregate.weights,
    contributions: aggregate.contributions,
    strengths: buildStrengths({ skills, education, experience, projects, certifications, roleSimilarity }),
    weaknesses: buildWeaknesses({ skills, education, experience, projects, certifications, resumeQuality }),
    recommendation: recommendationFor(aggregate.overall, skills.missingRequired.length)
  };
}
