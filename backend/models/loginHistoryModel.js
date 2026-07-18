import pool from "../database/pool.js";
import { enableLocalAuthFallback, isPostgresBigintId, shouldUseLocalAuth } from "../database/dbFallback.js";
import { getLocalLoginHistoryForUser, recordLocalLogin, recordLocalLogout } from "../database/localAuthStore.js";

async function withLocalAuthFallback(operation, fallback) {
  if (shouldUseLocalAuth()) return fallback();
  try {
    return await operation();
  } catch (error) {
    if (enableLocalAuthFallback(error)) return fallback();
    throw error;
  }
}

export async function recordLogin({ userId, ipAddress, browser, device, status = "success" }) {
  if (!isPostgresBigintId(userId)) return recordLocalLogin({ userId, ipAddress, browser, device, status });
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `INSERT INTO login_history (user_id, ip_address, browser, device, status)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, login_time`,
        [userId, ipAddress, browser, device, status]
      );
      return rows[0];
    },
    () => recordLocalLogin({ userId, ipAddress, browser, device, status })
  );
}

export async function recordLogout(loginHistoryId) {
  if (!isPostgresBigintId(loginHistoryId)) return recordLocalLogout(loginHistoryId);
  await withLocalAuthFallback(
    () => pool.query(
      `UPDATE login_history SET logout_time = now() WHERE id = $1`,
      [loginHistoryId]
    ),
    () => recordLocalLogout(loginHistoryId)
  );
}

export async function getLoginHistoryForUser(userId, limit = 50) {
  if (!isPostgresBigintId(userId)) return getLocalLoginHistoryForUser(userId, limit);
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `SELECT id, ip_address, browser, device, login_time, logout_time, status
         FROM login_history
         WHERE user_id = $1
         ORDER BY login_time DESC
         LIMIT $2`,
        [userId, limit]
      );
      return rows;
    },
    () => getLocalLoginHistoryForUser(userId, limit)
  );
}
