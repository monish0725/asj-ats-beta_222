import rateLimit from "express-rate-limit";

// Limits how many login attempts a single IP can make — the main brute-force guard now that
// auth is password-based instead of OTP-based.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts from this device. Please try again later." }
});

// Limits check-email / set-password calls per IP — looser than login itself, since these
// aren't password-guessing targets, but still worth capping against abuse/account enumeration.
export const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests from this device. Please try again later." }
});