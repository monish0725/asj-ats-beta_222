// Canonical skill dictionary: maps every known alias/spelling variant to one canonical
// name, so "JavaScript", "JS", and "Java Script" all match each other, "Node", "NodeJS",
// and "Node.js" all match each other, etc. This is the single source of truth every
// other matcher module normalizes through before comparing anything.
//
// Format: canonicalName -> [aliases...]. The canonical name itself doesn't need to be
// repeated in its alias list.
const SKILL_GROUPS = {
  "javascript": ["js", "java script", "ecmascript"],
  "typescript": ["ts"],
  "node.js": ["node", "nodejs", "node js"],
  "react": ["react.js", "reactjs"],
  "angular": ["angular.js", "angularjs"],
  "vue": ["vue.js", "vuejs"],
  "next.js": ["next", "nextjs"],
  "python": ["py"],
  "java": [],
  "c#": ["csharp", "c sharp"],
  "c++": ["cpp", "c plus plus"],
  ".net": ["dotnet", "dot net", ".net core", "asp.net"],
  "postgresql": ["postgres", "psql", "postgre sql"],
  "mysql": ["my sql"],
  "sql server": ["mssql", "ms sql", "microsoft sql server"],
  "mongodb": ["mongo", "mongo db"],
  "sql": ["structured query language"],
  "nosql": ["no sql"],
  "amazon web services": ["aws"],
  "microsoft azure": ["azure"],
  "google cloud platform": ["gcp", "google cloud"],
  "kubernetes": ["k8s"],
  "docker": ["docker containers", "dockerized"],
  "terraform": [],
  "jenkins": [],
  "ci/cd": ["cicd", "ci cd", "continuous integration", "continuous deployment"],
  "rest api": ["rest", "restful", "restful api", "restapi"],
  "graphql": ["graph ql"],
  "machine learning": ["ml"],
  "deep learning": ["dl"],
  "artificial intelligence": ["ai"],
  "natural language processing": ["nlp"],
  "computer vision": ["cv"],
  "data science": ["ds"],
  "html": ["html5"],
  "css": ["css3"],
  "tailwind css": ["tailwind", "tailwindcss"],
  "redux": [],
  "express": ["express.js", "expressjs"],
  "django": [],
  "flask": [],
  "spring boot": ["springboot", "spring"],
  "git": ["github", "gitlab", "version control"],
  "linux": ["unix"],
  "agile": ["scrum", "kanban"],
  "power bi": ["powerbi"],
  "tableau": [],
  "excel": ["ms excel", "microsoft excel"],
  "salesforce": [],
  "sap": [],
  "android": ["android development"],
  "ios": ["ios development", "swift"],
  "flutter": ["dart"],
  "react native": ["reactnative"]
};

// Reverse index: alias (lowercased) -> canonical name, including the canonical name
// mapping to itself, built once at module load.
const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of Object.entries(SKILL_GROUPS)) {
  ALIAS_TO_CANONICAL.set(canonical.toLowerCase(), canonical);
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(alias.toLowerCase(), canonical);
}

function cleanToken(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[_/]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.,;:()\[\]"'\s]+|[.,;:()\[\]"'\s]+$/g, "");
}

// Normalizes a single skill string to its canonical form. Unknown skills (not in the
// dictionary above) are returned cleaned but otherwise as-is, so the system still works
// for skills nobody thought to add synonyms for -- it just won't catch aliasing for them.
export function normalizeSkill(raw) {
  const cleaned = cleanToken(raw);
  if (!cleaned) return "";
  // Preserve "c#" / "c++" from having their punctuation stripped by cleanToken's trim rule
  const preserved = cleaned === "c" && /c#|c\+\+/i.test(String(raw)) ? String(raw).toLowerCase().trim() : cleaned;
  return ALIAS_TO_CANONICAL.get(preserved) || ALIAS_TO_CANONICAL.get(cleaned) || cleaned;
}

export function normalizeSkillList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const canonical = normalizeSkill(raw);
    if (canonical && !seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

// Every alias we know about, used by other modules to scan free text (job descriptions,
// resume "projects" sections) for skill mentions that weren't explicitly listed anywhere.
export function allKnownSkillSurfaceForms() {
  return [...ALIAS_TO_CANONICAL.keys()];
}

// Scans free text for any known skill (by alias or canonical name) and returns the
// canonical names found, deduplicated. Longer surface forms are checked first so
// "google cloud platform" matches before the substring "google cloud" would.
export function extractSkillsFromText(text) {
  // Replace word-separator punctuation with spaces, but leave '.', '+', '#' alone so
  // "node.js", "c++", and "c#" survive as single tokens instead of getting mangled.
  const scanText = ` ${String(text || "").toLowerCase().replace(/[,;:()[\]{}"'`|/]/g, " ").replace(/\s+/g, " ").trim()} `;
  const forms = allKnownSkillSurfaceForms().sort((a, b) => b.length - a.length);
  const found = new Set();
  for (const form of forms) {
    const pattern = ` ${form} `;
    if (scanText.includes(pattern)) found.add(ALIAS_TO_CANONICAL.get(form));
  }
  return [...found];
}

export { SKILL_GROUPS };
