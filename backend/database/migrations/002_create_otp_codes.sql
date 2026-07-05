-- Migration 002: otp_codes
-- OTPs are stored as bcrypt hashes only — the raw 6-digit code is never persisted.

CREATE TABLE IF NOT EXISTS otp_codes (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  otp_hash     VARCHAR(255) NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  verified     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_user_id ON otp_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires_at ON otp_codes (expires_at);

-- Speeds up "find latest active OTP for this user" lookups during verification.
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_active ON otp_codes (user_id, verified, expires_at);
