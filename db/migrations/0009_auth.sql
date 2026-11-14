-- ============================================================================
-- LAVA - authentication: users, sessions, and per-user conversation ownership
-- Migration 0009
--   app_user      : email + PBKDF2 password hash (no plaintext ever stored)
--   auth_session  : opaque bearer tokens; only the SHA-256 digest is persisted
--
-- The schema stays `ignis.*` (the project was renamed LAVA but the database
-- predates that). Conversations gain an owner so history is per-user.
-- ============================================================================

CREATE TABLE IF NOT EXISTS ignis.app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text,
  password_hash text NOT NULL,          -- format: pbkdf2$<iters>$<salt_b64>$<hash_b64>
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
-- Emails are compared case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS app_user_email_lower_idx ON ignis.app_user (lower(email));

CREATE TABLE IF NOT EXISTS ignis.auth_session (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES ignis.app_user(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,      -- sha256 hex of the bearer token
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen  timestamptz NOT NULL DEFAULT now(),
  user_agent text
);
CREATE INDEX IF NOT EXISTS auth_session_user_idx ON ignis.auth_session (user_id, expires_at DESC);

-- Conversations already carry a `user_id` text column (legacy); index it so the
-- per-user history query stays fast once sessions are scoped by owner.
CREATE INDEX IF NOT EXISTS conversation_user_idx ON ignis.conversation (user_id, created_at DESC);
