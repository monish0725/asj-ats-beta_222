import bcrypt from "bcryptjs";

const BCRYPT_SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(plainPassword, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Minimal, predictable strength check — at least 8 characters, at least one letter and one
 * number. Deliberately not over-engineered with character-class gymnastics that tend to
 * frustrate real users more than they stop real attackers.
 */
export function isStrongEnoughPassword(value) {
  if (typeof value !== "string") return false;
  if (value.length < MIN_PASSWORD_LENGTH) return false;
  if (!/[a-zA-Z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  return true;
}

export const passwordConfig = { MIN_PASSWORD_LENGTH };