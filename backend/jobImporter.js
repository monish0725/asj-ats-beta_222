const DEFAULT_TIMEOUT_MS = Number(process.env.JOB_IMPORT_TIMEOUT_MS || 30000);
const DEFAULT_RETRIES = Number(process.env.JOB_IMPORT_RETRIES || 2);

const SKILL_TERMS = [
  "React", "JavaScript", "TypeScript", "Node.js", "Express", "REST", "GraphQL", "PostgreSQL", "MongoDB",
  "AWS", "Azure", "GCP", "Docker", "Kubernetes", "Terraform", "CI/CD", "Jenkins", "Python", "Django",
  "SQL", "MySQL", "Power BI", "Tableau", "Data Analysis", "Healthcare", "Security", "Monitoring", "Agile",
  "Machine Learning", "Artificial Intelligence", "AI", "ML", "Deep Learning", "TensorFlow", "Keras",
  "Pandas", "NumPy", "OpenCV", "Computer Vision", "NLP", "FastAPI", "Figma", "Java", "Spring Boot", "Kafka"
];

function logImport(message, detail = {}) {
  console.log(`[job-import] ${message}`, JSON.stringify(detail));
}

function validateSourceUrl(sourceUrl) {
  const parsed = new URL(sourceUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only HTTP and HTTPS job URLs are supported.");
  return parsed;
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtmlToText(html) {
  return cleanText(String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|tr|td)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'"));
}

function parseJsonLd(html) {
  const blocks = [...String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const parsed = [];
  for (const block of blocks) {
    try {
      const json = JSON.parse(block[1].trim());
      parsed.push(...(Array.isArray(json) ? json : [json]));
    } catch (error) {
      logImport("Invalid JSON-LD block skipped", { error: error.message });
    }
  }
  const flattened = parsed.flatMap((entry) => entry?.["@graph"] || entry);
  return flattened.find((entry) => {
    const type = Array.isArray(entry?.["@type"]) ? entry["@type"] : [entry?.["@type"]];
    return type.some((item) => String(item || "").toLowerCase() === "jobposting");
  }) || null;
}

function textBetween(text, labels) {
  const source = cleanText(text);
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, "i");
    const match = source.match(pattern);
    if (match?.[1]) return cleanText(match[1]).slice(0, 180);
  }
  return "";
}

function extractDate(text) {
  const source = cleanText(text);
  const iso = source.match(/\b20\d{2}-\d{2}-\d{2}\b/);
  if (iso) return iso[0];
  const slash = source.match(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/);
  if (slash) return slash[0];
  const named = source.match(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+20\d{2}\b/i);
  return named?.[0] || "";
}

function extractSkillsFromText(text) {
  const lower = cleanText(text).toLowerCase();
  return SKILL_TERMS.filter((skill) => lower.includes(skill.toLowerCase())).slice(0, 20);
}

function normalizeJob(data, sourceUrl) {
  const description = cleanText(data.description || data.text || "");
  return {
    title: cleanText(data.title || "").slice(0, 180),
    organization: cleanText(data.organization || data.agency || "").slice(0, 180),
    location: cleanText(data.location || "").slice(0, 180),
    employmentType: cleanText(data.employmentType || "").slice(0, 80),
    skills: Array.isArray(data.skills) ? [...new Set(data.skills.map(cleanText).filter(Boolean))].slice(0, 20) : extractSkillsFromText(description),
    description: description.slice(0, 12000),
    contractValue: cleanText(data.contractValue || "").slice(0, 120),
    closingDate: cleanText(data.closingDate || "").slice(0, 80),
    sourceUrl
  };
}

function jobFromJsonLd(jsonLd, sourceUrl) {
  const hiringOrg = jsonLd.hiringOrganization;
  const location = jsonLd.jobLocation;
  const orgName = typeof hiringOrg === "string" ? hiringOrg : hiringOrg?.name;
  const locationText = Array.isArray(location)
    ? location.map((item) => item?.address?.addressLocality || item?.address?.addressRegion || item?.address?.addressCountry || item?.name).filter(Boolean).join(", ")
    : location?.address?.addressLocality || location?.address?.addressRegion || location?.address?.addressCountry || location?.name || "";
  return normalizeJob({
    title: jsonLd.title,
    organization: orgName,
    location: locationText,
    employmentType: Array.isArray(jsonLd.employmentType) ? jsonLd.employmentType.join(", ") : jsonLd.employmentType,
    skills: Array.isArray(jsonLd.skills) ? jsonLd.skills : String(jsonLd.skills || "").split(/,|;/),
    description: stripHtmlToText(jsonLd.description || ""),
    contractValue: jsonLd.baseSalary?.value?.value || jsonLd.estimatedSalary?.value?.value || "",
    closingDate: jsonLd.validThrough || "",
  }, sourceUrl);
}

function heuristicJobFromText(text, sourceUrl) {
  const cleaned = cleanText(text);
  const lines = cleaned.split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  const title = textBetween(cleaned, ["Title", "Opportunity title", "Job title", "Role"])
    || lines.find((line) => /engineer|developer|analyst|architect|consultant|specialist|manager|opportunity|administrator/i.test(line))
    || lines[0]
    || "Untitled opportunity";
  const contractValue = textBetween(cleaned, ["Contract value", "Estimated value", "Value", "Budget"]);
  const closingDate = textBetween(cleaned, ["Closing date", "Close date", "Applications close", "Response closing time"]) || extractDate(cleaned);
  return normalizeJob({
    title,
    organization: textBetween(cleaned, ["Agency", "Organisation", "Organization", "Buyer", "Department"]),
    location: textBetween(cleaned, ["Location", "Work location", "Place of work"]) || lines.find((line) => /remote|hybrid|canberra|sydney|melbourne|brisbane|perth|adelaide|australia/i.test(line)) || "",
    employmentType: /contract/i.test(cleaned) ? "Contract" : /part time/i.test(cleaned) ? "Part time" : /full time/i.test(cleaned) ? "Full time" : "",
    skills: extractSkillsFromText(cleaned),
    description: cleaned,
    contractValue,
    closingDate
  }, sourceUrl);
}

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 0; attempt <= DEFAULT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "ASJ-ATS-Beta/1.0 (+job-importer)",
          Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8"
        }
      });
      if (!response.ok) throw new Error(`URL returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") || "";
      return { html: await response.text(), contentType, renderedWith: "fetch" };
    } catch (error) {
      lastError = error;
      logImport("Fetch attempt failed", { url, attempt: attempt + 1, error: error.message });
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

async function renderWithPlaywright(url, options = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    return null;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent: "ASJ-ATS-Beta/1.0 (+job-importer)",
    viewport: { width: 1440, height: 1200 }
  });
  try {
    page.setDefaultTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS });
    await page.waitForLoadState("networkidle", { timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(Number(process.env.JOB_IMPORT_RENDER_SETTLE_MS || 1500));
    const html = await page.content();
    const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => stripHtmlToText(html));
    return { html, text, contentType: "text/html", renderedWith: "playwright" };
  } finally {
    await browser.close();
  }
}

function looksDynamicOrServiceNow(url, html, text) {
  const host = new URL(url).hostname.toLowerCase();
  return host.includes("buyict.gov.au")
    || /servicenow|now-experience|sys_id=|opportunity_details|u_lh_procurement/i.test(url)
    || stripHtmlToText(html).length < 1200
    || /enable javascript|loading/i.test(text || html);
}

async function llmNormalizeJob(text, sourceUrl) {
  if (!process.env.COHERE_API_KEY) return null;
  const response = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.COHERE_MODEL || "command-a-03-2025",
      messages: [
        { role: "system", content: "Extract job opportunity details. Return only valid JSON matching the requested schema." },
        { role: "user", content: `Source URL: ${sourceUrl}\n\nText:\n${cleanText(text).slice(0, 18000)}\n\nReturn JSON: {"title":"","organization":"","location":"","employmentType":"","skills":[],"description":"","contractValue":"","closingDate":"","sourceUrl":""}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`LLM extraction failed with HTTP ${response.status}`);
  const body = await response.json();
  const content = body.message?.content?.map((part) => part.text).join("\n") || "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  return normalizeJob(JSON.parse(content.slice(start, end + 1)), sourceUrl);
}

export async function importJobFromUrl(sourceUrl, options = {}) {
  const parsedUrl = validateSourceUrl(sourceUrl);
  logImport("Starting import", { url: parsedUrl.href });

  const fetched = await fetchWithRetry(parsedUrl.href, options);
  let html = fetched.html;
  let text = fetched.contentType.includes("json") ? cleanText(fetched.html) : stripHtmlToText(fetched.html);
  let renderedWith = fetched.renderedWith;

  if (looksDynamicOrServiceNow(parsedUrl.href, html, text)) {
    const rendered = await renderWithPlaywright(parsedUrl.href, options);
    if (rendered) {
      html = rendered.html;
      text = cleanText(rendered.text || stripHtmlToText(rendered.html));
      renderedWith = rendered.renderedWith;
    } else {
      throw new Error("This dynamic job site requires Playwright. Install dependencies and Chromium with `npm install` and `npx playwright install chromium`.");
    }
  }

  const jsonLd = parseJsonLd(html);
  if (jsonLd) {
    const job = jobFromJsonLd(jsonLd, parsedUrl.href);
    logImport("Imported from JSON-LD", { url: parsedUrl.href, title: job.title, renderedWith });
    return job;
  }

  try {
    const llmJob = await llmNormalizeJob(text, parsedUrl.href);
    if (llmJob?.title || llmJob?.description) {
      logImport("Imported from LLM-normalized text", { url: parsedUrl.href, title: llmJob.title, renderedWith });
      return llmJob;
    }
  } catch (error) {
    logImport("LLM normalization failed; using heuristic parser", { url: parsedUrl.href, error: error.message });
  }

  const job = heuristicJobFromText(text, parsedUrl.href);
  logImport("Imported from heuristic text", { url: parsedUrl.href, title: job.title, renderedWith });
  return job;
}
