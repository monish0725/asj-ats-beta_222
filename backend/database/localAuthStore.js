import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_FILE = process.env.DB_FILE ? resolve(process.env.DB_FILE) : resolve(ROOT, "data", "db.json");

function readDb() {
  if (!existsSync(DB_FILE)) return { users: [] };
  return JSON.parse(readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  writeFileSync(DB_FILE, `${JSON.stringify(db, null, 2)}\n`);
}

function nextUserId(users) {
  let max = 0;
  for (const user of users) {
    const match = String(user.id || "").match(/^u_(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `u_${max + 1}`;
}

function toDbUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: String(user.email || "").toLowerCase().trim(),
    role: user.role || "recruiter",
    department: user.department ?? null,
    phone: user.phone ?? null,
    password_hash: user.password_hash ?? null,
    is_verified: Boolean(user.is_verified ?? user.password_hash),
    status: user.status || (user.active === false ? "disabled" : "active"),
    created_at: user.created_at || user.createdAt || new Date().toISOString(),
    last_login: user.last_login || user.lastLogin || null
  };
}

function publicUser(user) {
  const normalized = toDbUser(user);
  const { password_hash, ...safe } = normalized;
  return safe;
}

function findIndexById(users, id) {
  return users.findIndex((user) => String(user.id) === String(id));
}

export function findLocalUserByEmail(email, { includePassword = false } = {}) {
  const db = readDb();
  const user = (db.users || []).map(toDbUser).find((item) => item.email === String(email || "").toLowerCase().trim());
  if (!user) return null;
  return includePassword ? user : publicUser(user);
}

export function findLocalUserById(id) {
  const db = readDb();
  const user = (db.users || []).map(toDbUser).find((item) => String(item.id) === String(id));
  return user ? publicUser(user) : null;
}

export function createLocalUser({ name, email, role = "recruiter", department = null, phone = null }) {
  const db = readDb();
  db.users ||= [];
  const user = toDbUser({
    id: nextUserId(db.users),
    name: name.trim(),
    email,
    role,
    department,
    phone,
    status: "active",
    created_at: new Date().toISOString()
  });
  db.users.push(user);
  writeDb(db);
  return publicUser(user);
}

export function listLocalUsers({ search = "", role = "", status = "" } = {}) {
  const needle = String(search || "").toLowerCase();
  return (readDb().users || [])
    .map(publicUser)
    .filter((user) => {
      if (needle && !`${user.name} ${user.email}`.toLowerCase().includes(needle)) return false;
      if (role && user.role !== role) return false;
      if (status && user.status !== status) return false;
      return true;
    })
    .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

export function updateLocalUser(id, { name, role, department, phone, status }) {
  const db = readDb();
  db.users ||= [];
  const index = findIndexById(db.users, id);
  if (index === -1) return null;
  const current = toDbUser(db.users[index]);
  db.users[index] = {
    ...current,
    name: name ?? current.name,
    role: role ?? current.role,
    department: department ?? current.department,
    phone: phone ?? current.phone,
    status: status ?? current.status
  };
  writeDb(db);
  return publicUser(db.users[index]);
}

export function setLocalUserStatus(id, status) {
  return updateLocalUser(id, { status });
}

export function deleteLocalUser(id) {
  const db = readDb();
  db.users ||= [];
  const before = db.users.length;
  db.users = db.users.filter((user) => String(user.id) !== String(id));
  if (db.users.length === before) return false;
  writeDb(db);
  return true;
}

export function touchLocalLastLogin(id) {
  const db = readDb();
  db.users ||= [];
  const index = findIndexById(db.users, id);
  if (index === -1) return;
  db.users[index] = { ...toDbUser(db.users[index]), last_login: new Date().toISOString() };
  writeDb(db);
}

export function setLocalPassword(id, passwordHash) {
  const db = readDb();
  db.users ||= [];
  const index = findIndexById(db.users, id);
  if (index === -1) return;
  db.users[index] = { ...toDbUser(db.users[index]), password_hash: passwordHash, is_verified: true };
  writeDb(db);
}

export function clearLocalPassword(id) {
  const db = readDb();
  db.users ||= [];
  const index = findIndexById(db.users, id);
  if (index === -1) return;
  db.users[index] = { ...toDbUser(db.users[index]), password_hash: null, is_verified: false };
  writeDb(db);
}

export function recordLocalLogin({ userId, ipAddress, browser, device, status = "success" }) {
  const db = readDb();
  db.loginHistory ||= [];
  const record = {
    id: `lh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    ip_address: ipAddress,
    browser,
    device,
    status,
    login_time: new Date().toISOString(),
    logout_time: null
  };
  db.loginHistory.push(record);
  writeDb(db);
  return { id: record.id, login_time: record.login_time };
}

export function recordLocalLogout(loginHistoryId) {
  const db = readDb();
  db.loginHistory ||= [];
  const index = db.loginHistory.findIndex((record) => String(record.id) === String(loginHistoryId));
  if (index === -1) return;
  db.loginHistory[index] = { ...db.loginHistory[index], logout_time: new Date().toISOString() };
  writeDb(db);
}

export function getLocalLoginHistoryForUser(userId, limit = 50) {
  return (readDb().loginHistory || [])
    .filter((record) => String(record.user_id) === String(userId))
    .sort((a, b) => String(b.login_time || "").localeCompare(String(a.login_time || "")))
    .slice(0, limit)
    .map((record) => ({
      id: record.id,
      ip_address: record.ip_address,
      browser: record.browser,
      device: record.device,
      login_time: record.login_time,
      logout_time: record.logout_time,
      status: record.status
    }));
}
