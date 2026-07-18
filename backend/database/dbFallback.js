let localAuthFallback = process.env.AUTH_STORAGE === "json";
let warned = false;

const FALLBACK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH"
]);

export function shouldUseLocalAuth() {
  return localAuthFallback;
}

export function isPostgresBigintId(id) {
  if (typeof id === "number") return Number.isSafeInteger(id) && id >= 0;
  return typeof id === "string" && /^[0-9]+$/.test(id);
}

export function enableLocalAuthFallback(error) {
  if (!FALLBACK_ERROR_CODES.has(error?.code)) return false;
  localAuthFallback = true;
  if (!warned) {
    warned = true;
    console.warn(`[auth] PostgreSQL is unreachable (${error.code}). Using local data/db.json auth store for this run.`);
  }
  return true;
}
