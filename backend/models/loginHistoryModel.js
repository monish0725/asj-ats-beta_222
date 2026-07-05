import pool from "../database/pool.js";

export async function recordLogin({ userId, ipAddress, browser, device, status = "success" }) {
  const { rows } = await pool.query(
    `INSERT INTO login_history (user_id, ip_address, browser, device, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, login_time`,
    [userId, ipAddress, browser, device, status]
  );
  return rows[0];
}

export async function recordLogout(loginHistoryId) {
  await pool.query(
    `UPDATE login_history SET logout_time = now() WHERE id = $1`,
    [loginHistoryId]
  );
}

export async function getLoginHistoryForUser(userId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, ip_address, browser, device, login_time, logout_time, status
     FROM login_history
     WHERE user_id = $1
     ORDER BY login_time DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows;
}
