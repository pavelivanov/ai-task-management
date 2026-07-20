DROP INDEX "one_active_focus_session_per_user";

CREATE UNIQUE INDEX "one_open_focus_session_per_user"
  ON "focus_sessions"("userId")
  WHERE "status" IN ('active', 'paused', 'waiting', 'blocked');
