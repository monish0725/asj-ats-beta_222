import pool from "../database/pool.js";

export async function createOtp({ userId, otpHash, expiresAt }) {
  const { rows } = await pool.query(
    `INSERT INTO otp_codes (user_id, otp_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, expires_at, attempts, verified, created_at`,
    [userId, otpHash, expiresAt]
  );
  return rows[0];
}

// The most recent OTP for a user that hasn't been verified yet (regardless of expiry —
// the service layer decides whether it's still usable, since "expired" and "not found"
// produce different, more helpful error messages to the user).
export async function findLatestActiveOtp(userId) {
  const { rows } = await pool.query(
    `SELECT id, user_id, otp_hash, expires_at, attempts, verified, created_at
     FROM otp_codes
     WHERE user_id = $1 AND verified = FALSE
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

export async function incrementAttempts(otpId) {
  const { rows } = await pool.query(
    `UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
    [otpId]
  );
  return rows[0]?.attempts ?? null;
}

export async function markOtpVerified(otpId) {
  await pool.query(`UPDATE otp_codes SET verified = TRUE WHERE id = $1`, [otpId]);
}

// Invalidates any still-pending OTPs for a user (used right before issuing a new one, so a
// user can never have two simultaneously "live" codes — only the newest one ever works).
export async function invalidatePendingOtps(userId) {
  await pool.query(
    `UPDATE otp_codes SET verified = TRUE WHERE user_id = $1 AND verified = FALSE`,
    [userId]
  );
}

export async function deleteExpiredOtps() {
  const { rowCount } = await pool.query(`DELETE FROM otp_codes WHERE expires_at < now()`);
  return rowCount;
}
