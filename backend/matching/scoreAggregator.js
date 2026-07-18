// The canonical weight table from the spec. These are the weights used whenever every
// component (including semantic similarity) is available.
export const SCORE_WEIGHTS = {
  requiredSkills: 30,
  preferredSkills: 10,
  experience: 20,
  education: 10,
  projects: 10,
  certifications: 5,
  roleSimilarity: 5,
  resumeQuality: 5,
  semantic: 5
};

// When the semantic component is unavailable (no embeddings provider configured), its
// weight is redistributed proportionally across the remaining eight components rather
// than either (a) dropping the candidate's total possible score to 95, which would make
// every score look artificially low, or (b) inventing a semantic number, which the spec
// explicitly rules out. Proportional redistribution preserves the *relative* importance
// the spec assigned to each remaining component.
function effectiveWeights(semanticAvailable, baseWeights = SCORE_WEIGHTS) {
  if (semanticAvailable) return baseWeights;
  const { semantic, ...rest } = baseWeights;
  const restTotal = Object.values(rest).reduce((sum, w) => sum + w, 0);
  const scale = restTotal ? 100 / restTotal : 1;
  const scaled = {};
  for (const [key, weight] of Object.entries(rest)) scaled[key] = weight * scale;
  scaled.semantic = 0;
  return scaled;
}

export function aggregateScore({ skills, education, experience, projects, certifications, roleSimilarity, resumeQuality, semantic }, baseWeights) {
  const semanticAvailable = semantic.status === "ok" && typeof semantic.score === "number";
  const weights = effectiveWeights(semanticAvailable, baseWeights || SCORE_WEIGHTS);

  const components = {
    requiredSkills: skills.requiredScore,
    preferredSkills: skills.preferredScore,
    experience: experience.score,
    education: education.score,
    projects: projects.score,
    certifications: certifications.score,
    roleSimilarity: roleSimilarity.score,
    resumeQuality: resumeQuality.score,
    semantic: semanticAvailable ? semantic.score : 0
  };

  let overall = 0;
  const contributions = {};
  for (const [key, weight] of Object.entries(weights)) {
    const contribution = (components[key] / 100) * weight;
    contributions[key] = Math.round(contribution * 10) / 10;
    overall += contribution;
  }

  return {
    overall: Math.round(Math.max(0, Math.min(100, overall))),
    components,
    weights,
    contributions,
    semanticAvailable
  };
}
