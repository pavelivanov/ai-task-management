CREATE TYPE "FocusSessionStatus" AS ENUM (
  'active',
  'paused',
  'waiting',
  'blocked',
  'completed',
  'stopped'
);

CREATE TYPE "FocusSegmentType" AS ENUM ('focused', 'paused', 'waiting');

CREATE TABLE "focus_sessions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "status" "FocusSessionStatus" NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "endedAt" TIMESTAMPTZ(3),
  "initialIntent" TEXT,
  "outcome" TEXT,
  "interruptionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "focus_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "focus_sessions_version" CHECK ("version" > 0),
  CONSTRAINT "focus_sessions_end_state" CHECK (
    ("status" IN ('completed', 'stopped') AND "endedAt" IS NOT NULL) OR
    ("status" NOT IN ('completed', 'stopped') AND "endedAt" IS NULL)
  ),
  CONSTRAINT "focus_sessions_time_order" CHECK (
    "endedAt" IS NULL OR "endedAt" >= "startedAt"
  )
);

CREATE TABLE "focus_session_segments" (
  "id" UUID NOT NULL,
  "focusSessionId" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "FocusSegmentType" NOT NULL,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "endedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "focus_session_segments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "focus_session_segments_sequence" CHECK ("sequence" >= 0),
  CONSTRAINT "focus_session_segments_time_order" CHECK (
    "endedAt" IS NULL OR "endedAt" >= "startedAt"
  )
);

CREATE INDEX "focus_sessions_userId_status_startedAt_id_idx"
  ON "focus_sessions"("userId", "status", "startedAt", "id");
CREATE INDEX "focus_sessions_taskId_startedAt_id_idx"
  ON "focus_sessions"("taskId", "startedAt", "id");
CREATE INDEX "focus_session_segments_focusSessionId_startedAt_id_idx"
  ON "focus_session_segments"("focusSessionId", "startedAt", "id");
CREATE UNIQUE INDEX "focus_session_segments_focusSessionId_sequence_key"
  ON "focus_session_segments"("focusSessionId", "sequence");

-- Prisma schema syntax cannot represent partial unique indexes. These indexes
-- are authoritative invariants and must remain in future hand-authored
-- migrations even when Prisma generates the surrounding table changes.
CREATE UNIQUE INDEX "one_active_focus_session_per_user"
  ON "focus_sessions"("userId")
  WHERE "status" = 'active';

CREATE UNIQUE INDEX "one_open_segment_per_focus_session"
  ON "focus_session_segments"("focusSessionId")
  WHERE "endedAt" IS NULL;

ALTER TABLE "focus_sessions"
  ADD CONSTRAINT "focus_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "focus_sessions"
  ADD CONSTRAINT "focus_sessions_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "focus_session_segments"
  ADD CONSTRAINT "focus_session_segments_focusSessionId_fkey"
  FOREIGN KEY ("focusSessionId") REFERENCES "focus_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
