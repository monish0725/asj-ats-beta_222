import pool from "../database/pool.js";
import { enableLocalAuthFallback, isPostgresBigintId, shouldUseLocalAuth } from "../database/dbFallback.js";
import {
  clearLocalPassword,
  createLocalUser,
  deleteLocalUser,
  findLocalUserByEmail,
  findLocalUserById,
  listLocalUsers,
  setLocalPassword,
  setLocalUserStatus,
  touchLocalLastLogin,
  updateLocalUser
} from "../database/localAuthStore.js";

const SAFE_COLUMNS = `id, name, email, role, department, phone, is_verified, status, created_at, last_login`;

async function withLocalAuthFallback(operation, fallback) {
  if (shouldUseLocalAuth()) return fallback();
  try {
    return await operation();
  } catch (error) {
    if (enableLocalAuthFallback(error)) return fallback();
    throw error;
  }
}

export async function findUserByEmail(email) {
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `SELECT ${SAFE_COLUMNS} FROM users WHERE email = $1`,
        [email.toLowerCase().trim()]
      );
      return rows[0] || null;
    },
    () => findLocalUserByEmail(email)
  );
}

// Includes password_hash — only ever call this from the login/password-check code path.
// Every other read of a user should go through findUserByEmail/findUserById instead, so the
// hash never accidentally ends up in an API response.
export async function findUserByEmailWithPassword(email) {
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `SELECT ${SAFE_COLUMNS}, password_hash FROM users WHERE email = $1`,
        [email.toLowerCase().trim()]
      );
      return rows[0] || null;
    },
    () => findLocalUserByEmail(email, { includePassword: true })
  );
}

export async function findUserById(id) {
  if (!isPostgresBigintId(id)) return findLocalUserById(id);
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `SELECT ${SAFE_COLUMNS} FROM users WHERE id = $1`,
        [id]
      );
      return rows[0] || null;
    },
    () => findLocalUserById(id)
  );
}

export async function createUser({ name, email, role = "recruiter", department = null, phone = null }) {
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, role, department, phone)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${SAFE_COLUMNS}`,
        [name.trim(), email.toLowerCase().trim(), role, department, phone]
      );
      return rows[0];
    },
    () => createLocalUser({ name, email, role, department, phone })
  );
}

export async function listUsers({ search = "", role = "", status = "" } = {}) {
  return withLocalAuthFallback(
    async () => {
      const conditions = [];
      const params = [];

      if (search) {
        params.push(`%${search.toLowerCase()}%`);
        conditions.push(`(LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`);
      }
      if (role) {
        params.push(role);
        conditions.push(`role = $${params.length}`);
      }
      if (status) {
        params.push(status);
        conditions.push(`status = $${params.length}`);
      }

      const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
      const { rows } = await pool.query(
        `SELECT ${SAFE_COLUMNS} FROM users ${whereClause} ORDER BY created_at DESC`,
        params
      );
      return rows;
    },
    () => listLocalUsers({ search, role, status })
  );
}

export async function updateUser(id, { name, role, department, phone }) {
  if (!isPostgresBigintId(id)) return updateLocalUser(id, { name, role, department, phone });
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `UPDATE users
         SET name = COALESCE($2, name),
             role = COALESCE($3, role),
             department = COALESCE($4, department),
             phone = COALESCE($5, phone)
         WHERE id = $1
         RETURNING ${SAFE_COLUMNS}`,
        [id, name, role, department, phone]
      );
      return rows[0] || null;
    },
    () => updateLocalUser(id, { name, role, department, phone })
  );
}

export async function setUserStatus(id, status) {
  if (!isPostgresBigintId(id)) return setLocalUserStatus(id, status);
  return withLocalAuthFallback(
    async () => {
      const { rows } = await pool.query(
        `UPDATE users SET status = $2 WHERE id = $1 RETURNING ${SAFE_COLUMNS}`,
        [id, status]
      );
      return rows[0] || null;
    },
    () => setLocalUserStatus(id, status)
  );
}

export async function deleteUser(id) {
  if (!isPostgresBigintId(id)) return deleteLocalUser(id);
  return withLocalAuthFallback(
    async () => {
      const { rowCount } = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
      return rowCount > 0;
    },
    () => deleteLocalUser(id)
  );
}

export async function touchLastLogin(id) {
  if (!isPostgresBigintId(id)) return touchLocalLastLogin(id);
  await withLocalAuthFallback(
    () => pool.query(`UPDATE users SET last_login = now() WHERE id = $1`, [id]),
    () => touchLocalLastLogin(id)
  );
}

// Sets a user's password and marks them verified (is_verified now means "has a password
// and can log in", since there's no separate signup/email-confirmation step in this app).
export async function setPassword(id, passwordHash) {
  if (!isPostgresBigintId(id)) return setLocalPassword(id, passwordHash);
  await withLocalAuthFallback(
    () => pool.query(
      `UPDATE users SET password_hash = $2, is_verified = TRUE WHERE id = $1`,
      [id, passwordHash]
    ),
    () => setLocalPassword(id, passwordHash)
  );
}

// Admin "Reset password" action: clears the existing password so the user has to go through
// the "create a new password" step again on their next sign-in attempt.
export async function clearPassword(id) {
  if (!isPostgresBigintId(id)) return clearLocalPassword(id);
  await withLocalAuthFallback(
    () => pool.query(
      `UPDATE users SET password_hash = NULL, is_verified = FALSE WHERE id = $1`,
      [id]
    ),
    () => clearLocalPassword(id)
  );
}
