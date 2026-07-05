import {
  findUserByEmail,
  findUserByEmailWithPassword,
  createUser,
  touchLastLogin,
  setPassword
} from "../models/userModel.js";
import { recordLogin, recordLogout } from "../models/loginHistoryModel.js";
import { hashPassword, verifyPassword, isStrongEnoughPassword, passwordConfig } from "../services/passwordService.js";
import { signToken, AUTH_COOKIE_NAME, authCookieOptions, verifyToken } from "../utils/jwt.js";
import { isValidEmail, isValidName, isValidRole } from "../utils/validation.js";
import { parseUserAgent, getClientIp } from "../utils/requestInfo.js";

async function startSession(req, res, user) {
  await touchLastLogin(user.id);

  const { browser, device } = parseUserAgent(req.headers["user-agent"]);
  const loginRecord = await recordLogin({
    userId: user.id,
    ipAddress: getClientIp(req),
    browser,
    device,
    status: "success"
  });

  const token = signToken({ sub: user.id, email: user.email, role: user.role, loginHistoryId: loginRecord.id });
  res.cookie(AUTH_COOKIE_NAME, token, authCookieOptions());

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.department
  };
}

/**
 * POST /auth/check-email
 * Body: { email }
 *
 * First step of sign-in: tells the frontend whether to show a "create your password" form
 * (brand-new email, or an existing account that's never set one) or a normal password field.
 */
export async function checkEmail(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim();
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }

    const user = await findUserByEmailWithPassword(email);
    if (!user) {
      return res.json({ exists: false, needsPassword: true });
    }
    if (user.status === "disabled") {
      return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
    }

    res.json({ exists: true, needsPassword: !user.password_hash });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/set-password
 * Body: { email, name?, password }
 *
 * Used the first time someone signs in with a given email (new account) or for an existing
 * account that's never had a password set. Creates the account if it doesn't exist yet, sets
 * the password, and logs the user straight in.
 */
export async function setPasswordHandler(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim();
    const name = String(req.body?.name || "").trim();
    const password = String(req.body?.password || "");
    const role = isValidRole(String(req.body?.role || "")) ? String(req.body.role) : "recruiter";

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Enter a valid email address." });
    }
    if (!isStrongEnoughPassword(password)) {
      return res.status(400).json({
        error: `Password must be at least ${passwordConfig.MIN_PASSWORD_LENGTH} characters and include a letter and a number.`
      });
    }

    let user = await findUserByEmailWithPassword(email);
    if (!user) {
      if (!isValidName(name)) {
        return res.status(400).json({ error: "Enter your name to create an account." });
      }
      user = await createUser({ name, email, role });
    } else if (user.password_hash) {
      // Account already has a password — this endpoint isn't the right one to call anymore.
      return res.status(400).json({ error: "This account already has a password. Sign in instead." });
    }

    if (user.status === "disabled") {
      return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
    }

    const passwordHash = await hashPassword(password);
    await setPassword(user.id, passwordHash);

    const sessionUser = await startSession(req, res, user);
    res.json({ message: "Password created. You're signed in.", user: sessionUser });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/login
 * Body: { email, password }
 */
export async function login(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");

    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: "Enter your email and password." });
    }

    const user = await findUserByEmailWithPassword(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }
    if (user.status === "disabled") {
      return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
    }

    const matches = await verifyPassword(password, user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const sessionUser = await startSession(req, res, user);
    res.json({ message: "Signed in successfully.", user: sessionUser });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /auth/logout
 */
export async function logout(req, res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME];
    if (token) {
      try {
        const payload = verifyToken(token);
        if (payload.loginHistoryId) await recordLogout(payload.loginHistoryId);
      } catch {
        // Token already invalid/expired — nothing to record, just clear the cookie below.
      }
    }
    const { maxAge, ...clearOptions } = authCookieOptions();
    res.clearCookie(AUTH_COOKIE_NAME, clearOptions);
    res.json({ message: "Signed out." });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /auth/me
 */
export async function me(req, res) {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      department: req.user.department
    }
  });
}

/**
 * GET /auth/profile
 */
export async function profile(req, res) {
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      department: req.user.department,
      phone: req.user.phone,
      isVerified: req.user.is_verified,
      status: req.user.status,
      createdAt: req.user.created_at,
      lastLogin: req.user.last_login
    }
  });
}