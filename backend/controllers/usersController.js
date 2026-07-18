import {
  listUsers,
  findUserById,
  updateUser,
  setUserStatus,
  deleteUser,
  clearPassword
} from "../models/userModel.js";
import { getLoginHistoryForUser } from "../models/loginHistoryModel.js";
import { isValidRole } from "../utils/validation.js";

function routeId(param) {
  const numeric = Number(param);
  return Number.isNaN(numeric) ? param : numeric;
}

export async function getUsers(req, res, next) {
  try {
    const { search = "", role = "", status = "" } = req.query;
    const users = await listUsers({ search, role, status });
    res.json({ users });
  } catch (error) {
    next(error);
  }
}

export async function updateUserHandler(req, res, next) {
  try {
    const id = routeId(req.params.id);
    const { name, role, department, phone } = req.body || {};

    if (role && !isValidRole(role)) {
      return res.status(400).json({ error: "Invalid role." });
    }

    const updated = await updateUser(id, { name, role, department, phone });
    if (!updated) return res.status(404).json({ error: "User not found." });
    res.json({ user: updated });
  } catch (error) {
    next(error);
  }
}

export async function disableUserHandler(req, res, next) {
  try {
    const id = routeId(req.params.id);
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ error: "You can't disable your own account." });
    }
    const updated = await setUserStatus(id, "disabled");
    if (!updated) return res.status(404).json({ error: "User not found." });
    res.json({ user: updated });
  } catch (error) {
    next(error);
  }
}

export async function enableUserHandler(req, res, next) {
  try {
    const id = routeId(req.params.id);
    const updated = await setUserStatus(id, "active");
    if (!updated) return res.status(404).json({ error: "User not found." });
    res.json({ user: updated });
  } catch (error) {
    next(error);
  }
}

export async function deleteUserHandler(req, res, next) {
  try {
    const id = routeId(req.params.id);
    if (String(id) === String(req.user.id)) {
      return res.status(400).json({ error: "You can't delete your own account." });
    }
    const existing = await findUserById(id);
    if (!existing) return res.status(404).json({ error: "User not found." });
    await deleteUser(id);
    res.json({ message: "User deleted." });
  } catch (error) {
    next(error);
  }
}

// Admin "Reset password" action: clears the user's password so they have to set a new one
// (via the normal "create password" step) the next time they try to sign in.
export async function resetPasswordHandler(req, res, next) {
  try {
    const id = routeId(req.params.id);
    const existing = await findUserById(id);
    if (!existing) return res.status(404).json({ error: "User not found." });
    await clearPassword(id);
    res.json({ message: `${existing.email} will need to set a new password on their next sign-in.` });
  } catch (error) {
    next(error);
  }
}

export async function loginHistoryHandler(req, res, next) {
  try {
    const id = routeId(req.params.id);
    const existing = await findUserById(id);
    if (!existing) return res.status(404).json({ error: "User not found." });
    const history = await getLoginHistoryForUser(id);
    res.json({ history });
  } catch (error) {
    next(error);
  }
}
