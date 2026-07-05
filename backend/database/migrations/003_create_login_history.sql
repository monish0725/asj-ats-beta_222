-- Migration 003: login_history
-- One row per login/logout lifecycle event, used by the Users page "View Login History" action.

CREATE TABLE IF NOT EXISTS login_history (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ip_address   VARCHAR(64),
  browser      VARCHAR(160),
  device       VARCHAR(160),
  login_time   TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_time  TIMESTAMPTZ,
  status       VARCHAR(20) NOT NULL DEFAULT 'success',
  CONSTRAINT login_history_status_check CHECK (status IN ('success', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_login_history_user_id ON login_history (user_id);
CREATE INDEX IF NOT EXISTS idx_login_history_login_time ON login_history (login_time DESC);
