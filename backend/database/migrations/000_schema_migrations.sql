-- Migration 000: schema_migrations
-- Tracks which migration files have already run, so the runner never re-applies one.
-- (Created automatically by database/migrate.js on first run — this file documents its shape.)

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    VARCHAR(255) PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
