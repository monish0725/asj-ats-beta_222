// Degree/field-of-study relevance tables, keyed by the job's inferred "role family".
// Each entry maps a field-of-study keyword to a 0-100 relevance score for that family.
// Software Developer roles rank Computer Science/IT/Software Engineering highest, then
// AI & Data Science, then Computer Engineering, then Electronics/ECE, with unrelated
// degrees scoring low but not zero (a self-taught or career-switch candidate with a
// strong project/skill match shouldn't be tanked purely by degree field).
const EDUCATION_RELEVANCE = {
  software_developer: {
    "computer science": 100, "information technology": 100, "software engineering": 100,
    "artificial intelligence": 85, "data science": 85, "ai & ds": 85, "ai and ds": 85,
    "computer engineering": 75,
    "electronics and communication": 60, "electronics": 60, "ece": 60, "e&c": 60,
    "information science": 90,
    "mathematics": 55, "statistics": 55, "physics": 45,
    "mechanical engineering": 35, "civil engineering": 30, "electrical engineering": 55,
    default: 35
  },
  data_analyst: {
    "data science": 100, "statistics": 95, "mathematics": 90, "computer science": 85,
    "information technology": 75, "artificial intelligence": 90, "ai & ds": 95,
    "economics": 70, "commerce": 55, "electronics": 50,
    default: 35
  },
  network_security: {
    "computer science": 95, "information technology": 100, "cyber security": 100,
    "electronics and communication": 70, "electronics": 65, "computer engineering": 90,
    default: 30
  },
  general: {
    "computer science": 90, "information technology": 85, "software engineering": 90,
    "business administration": 70, "commerce": 65, "engineering": 60,
    default: 45
  }
};

const FIELD_KEYWORDS = Object.keys(EDUCATION_RELEVANCE.software_developer).filter((key) => key !== "default")
  .concat(["business administration", "commerce", "engineering", "economics", "cyber security", "information science"]);

// Classifies a job into a role family so the right relevance table gets used. Falls back
// to "general" for anything that doesn't clearly look like a dev, analyst, or security role.
export function inferRoleFamily(job) {
  const title = String(job?.title || "").toLowerCase();
  if (/security|cyber|network/.test(title)) return "network_security";
  if (/data (analyst|scientist)|analytics|bi\b/.test(title)) return "data_analyst";
  if (/developer|engineer|programmer|software|full stack|frontend|backend|devops/.test(title)) return "software_developer";
  return "general";
}

// Pulls the highest-relevance field of study mentioned anywhere in the resume text. Real
// resumes are messy about how they phrase degrees ("B.Tech in Computer Science and
// Engineering", "BE - CSE", etc.) so this looks for keyword mentions rather than trying
// to parse a strict "Degree, Field, Institution" grammar.
export function extractEducationField(resumeText) {
  const text = String(resumeText || "").toLowerCase();
  const candidates = FIELD_KEYWORDS.filter((keyword) => text.includes(keyword));
  // Common abbreviations that wouldn't survive a plain keyword scan
  if (/\bcse\b/.test(text)) candidates.push("computer science");
  if (/\bcs\b/.test(text) && !candidates.includes("computer science")) candidates.push("computer science");
  if (/\bit\b/.test(text) && /degree|b\.?tech|b\.?e\.?|bachelor|diploma/.test(text)) candidates.push("information technology");
  if (/\bece\b/.test(text)) candidates.push("ece");
  if (/\bai\s*&?\s*ds\b|artificial intelligence and data science/.test(text)) candidates.push("ai & ds");
  return candidates.length ? candidates[0] : null;
}

export function matchEducation(candidate, job) {
  const roleFamily = inferRoleFamily(job);
  const table = EDUCATION_RELEVANCE[roleFamily] || EDUCATION_RELEVANCE.general;
  const field = extractEducationField(candidate.resumeText || candidate.education || "");
  const score = field ? (table[field] ?? table.default) : table.default;
  return {
    score,
    roleFamily,
    detectedField: field,
    hasDegreeInformation: Boolean(field)
  };
}
