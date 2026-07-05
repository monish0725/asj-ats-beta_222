import validator from "validator";

// A plain, forgiving regex instead of validator.isEmail(): it only requires
// "something@something.something" and won't reject real addresses over edge cases
// like uncommon TLDs, length quirks, or stricter RFC corners that validator.js enforces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value) {
  if (typeof value !== "string") return false;
  return EMAIL_PATTERN.test(value.trim());
}

export function isValidOtpFormat(value) {
  return typeof value === "string" && /^\d{6}$/.test(value.trim());
}

export function isValidName(value) {
  return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 160;
}

const ALLOWED_ROLES = ["admin", "recruiter", "account_manager", "hiring_manager", "viewer"];
export function isValidRole(value) {
  return ALLOWED_ROLES.includes(value);
}
export { ALLOWED_ROLES };