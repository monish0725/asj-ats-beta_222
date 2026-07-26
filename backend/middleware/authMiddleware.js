import { verifyToken, AUTH_COOKIE_NAME } from "../utils/jwt.js";
import { findUserById } from "../models/userModel.js";

function bearerToken(req) {
  const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

/**
 * Requires a valid JWT cookie. On success, attaches the current user (freshly loaded from
 * the database, not just trusted from the token payload) to req.user.
 *
 * Re-fetching from the DB on every request (rather than trusting the token's embedded role/
 * status) matters for correctness: if an admin disables a user or changes their role, that
 * change takes effect on their very next request instead of only after their old token expires.
 */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[AUTH_COOKIE_NAME] || bearerToken(req);
    if (!token) {
      return res.status(401).json({ error: "Not authenticated." });
    }

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      return res.status(401).json({ error: "Session expired or invalid. Please sign in again." });
    }

    const user = await findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Account no longer exists." });
    }
    if (user.status === "disabled") {
      return res.status(403).json({ error: "This account has been disabled. Contact an administrator." });
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Restricts a route to one or more roles. Use after requireAuth.
 * Example: router.delete("/users/:id", requireAuth, requireRole("admin"), handler)
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated." });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do that." });
    }
    next();
  };
}
