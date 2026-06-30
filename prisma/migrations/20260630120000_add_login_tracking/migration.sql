-- Add lastLoginAt column to fc_user
ALTER TABLE shipcore."fc_user" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- Create fc_user_login_log table
CREATE TABLE IF NOT EXISTS shipcore."fc_user_login_log" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "loggedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip"         TEXT,
  "userAgent"  TEXT,
  CONSTRAINT "fc_user_login_log_pkey" PRIMARY KEY ("id")
);

-- Index for fast lookup by user + descending time
CREATE INDEX IF NOT EXISTS "fc_user_login_log_userId_loggedInAt_idx"
  ON shipcore."fc_user_login_log"("userId", "loggedInAt" DESC);

-- Foreign key to fc_user with cascade delete
ALTER TABLE shipcore."fc_user_login_log"
  ADD CONSTRAINT "fc_user_login_log_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES shipcore."fc_user"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
