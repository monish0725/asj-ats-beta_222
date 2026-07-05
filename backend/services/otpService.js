import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import {
  createOtp,
  findLatestActiveOtp,
  incrementAttempts,
  markOtpVerified,
  invalidatePendingOtps
} from "../models/otpModel.js";

const OTP_EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const BCRYPT_SALT_ROUNDS = 10;

// crypto.randomInt is cryptographically secure (unlike Math.random, which is not safe for
// anything security-sensitive — it's seeded predictably and has been used to break OTP/token
// schemes in the past). randomInt(100000, 1000000) yields a uniformly random 6-digit number.
function generateOtpCode() {
  return String(randomInt(100000, 1000000));
}

/**
 * Issues a new OTP for a user: invalidates any still-pending OTP first (so only the newest
 * code ever works), generates a fresh 6-digit code, hashes it, and stores the hash.
 * Returns the RAW code (only place it ever exists in plaintext) so the caller can email it —
 * it is never written to the database or logged.
 */
export async function issueOtp(userId) {
  await invalidatePendingOtps(userId);

  const rawCode = generateOtpCode();
  const otpHash = await bcrypt.hash(rawCode, BCRYPT_SALT_ROUNDS);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const record = await createOtp({ userId, otpHash, expiresAt });
  return { rawCode, otpId: record.id, expiresAt };
}

/**
 * Checks whether a user is allowed to request a new OTP right now, based on the 60-second
 * resend cooldown. Returns { allowed, secondsRemaining }.
 */
export async function checkResendCooldown(userId) {
  const latest = await findLatestActiveOtp(userId);
  if (!latest) return { allowed: true, secondsRemaining: 0 };

  const elapsedMs = Date.now() - new Date(latest.created_at).getTime();
  const cooldownMs = OTP_RESEND_SECONDS * 1000;
  if (elapsedMs >= cooldownMs) return { allowed: true, secondsRemaining: 0 };

  return { allowed: false, secondsRemaining: Math.ceil((cooldownMs - elapsedMs) / 1000) };
}

/**
 * Verifies a submitted OTP code against the user's latest pending OTP.
 * Returns { success: true } on match, or { success: false, reason } on failure, where reason
 * is one of: "not_found", "expired", "too_many_attempts", "incorrect".
 */
export async function verifyOtp(userId, submittedCode) {
  const otp = await findLatestActiveOtp(userId);
  if (!otp) return { success: false, reason: "not_found" };

  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    return { success: false, reason: "too_many_attempts" };
  }

  if (new Date(otp.expires_at).getTime() < Date.now()) {
    return { success: false, reason: "expired" };
  }

  const matches = await bcrypt.compare(String(submittedCode), otp.otp_hash);
  if (!matches) {
    const attemptsNow = await incrementAttempts(otp.id);
    const attemptsRemaining = Math.max(0, OTP_MAX_ATTEMPTS - attemptsNow);
    return { success: false, reason: "incorrect", attemptsRemaining };
  }

  // Correct code: mark this OTP as used immediately so it can never be replayed.
  await markOtpVerified(otp.id);
  return { success: true };
}

export const otpConfig = { OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS, OTP_RESEND_SECONDS };
