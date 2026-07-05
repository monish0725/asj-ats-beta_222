-- Migration 004: switch from OTP-based auth to email + password
-- password_hash is nullable: a user can exist (created by an admin, or mid-first-login)
-- before they've set a password yet. is_verified now means "has set a password and can log in".

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

DROP TABLE IF EXISTS otp_codes;