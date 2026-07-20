CREATE TABLE "daily_reviews" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "primaryOutcomeCompleted" BOOLEAN NOT NULL DEFAULT false,
  "focusedMinutes" INTEGER NOT NULL DEFAULT 0,
  "completedPlannedTasks" INTEGER NOT NULL DEFAULT 0,
  "completedUnplannedTasks" INTEGER NOT NULL DEFAULT 0,
  "carriedOverTasks" INTEGER NOT NULL DEFAULT 0,
  "focusSessions" INTEGER NOT NULL DEFAULT 0,
  "interruptionCount" INTEGER NOT NULL DEFAULT 0,
  "userReflection" TEXT,
  "assistantSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_reviews_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_reviews_nonnegative_metrics" CHECK (
    "focusedMinutes" >= 0 AND
    "completedPlannedTasks" >= 0 AND
    "completedUnplannedTasks" >= 0 AND
    "carriedOverTasks" >= 0 AND
    "focusSessions" >= 0 AND
    "interruptionCount" >= 0
  )
);

CREATE UNIQUE INDEX "daily_reviews_userId_date_key"
  ON "daily_reviews"("userId", "date");
CREATE INDEX "daily_reviews_userId_date_idx"
  ON "daily_reviews"("userId", "date");

ALTER TABLE "daily_reviews"
  ADD CONSTRAINT "daily_reviews_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
