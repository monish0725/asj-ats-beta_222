-- Migration 001: users
-- Core identity table. No password column — authentication is OTP-only per spec.

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  name          VARCHAR(160)  NOT NULL,
  email         VARCHAR(255)  NOT NULL UNIQUE,
  role          VARCHAR(40)   NOT NULL DEFAULT 'recruiter',
  department    VARCHAR(120),
  phone         VARCHAR(40),
  is_verified   BOOLEAN       NOT NULL DEFAULT FALSE,
  status        VARCHAR(20)   NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ,
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'recruiter', 'account_manager', 'hiring_manager', 'viewer')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users (status);
