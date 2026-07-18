import { inferRoleFamily } from "./educationMatcher.js";

const FAMILY_KEYWORDS = {
  software_developer: ["developer", "engineer", "programmer", "software", "full stack", "backend", "frontend", "devops"],
  data_analyst: ["data", "analyst", "analytics", "bi", "scientist"],
  network_security: ["security", "network", "cyber", "infrastructure"],
  general: []
};

// Distinct from the Experience Matcher's role-relevance check (which only compares
// currentRole tokens against the job title): this looks at the candidate's broader role
// category and any AI-parsed "eligible roles" list, so a candidate who's clearly in the
// right career lane overall still scores well here even if their most recent job title
// happens to be worded very differently from this specific opening.
export function matchRoleSimilarity(candidate, job) {
  const family = inferRoleFamily(job);
  const keywords = FAMILY_KEYWORDS[family] || [];
  const haystacks = [
    candidate.roleCategory, candidate.currentRole,
    ...(candidate.eligibleRoles || []), ...(candidate.tags || [])
  ].filter(Boolean).map((value) => String(value).toLowerCase());

  if (!haystacks.length) return { score: 50, family, matched: false }; // no signal, stay neutral
  if (!keywords.length) return { score: 60, family, matched: false }; // "general" family, nothing specific to check against

  const matched = haystacks.some((value) => keywords.some((keyword) => value.includes(keyword)));
  return { score: matched ? 100 : 40, family, matched };
}
