CREATE TYPE "DailyPlanStatus" AS ENUM ('draft', 'active', 'closed');
CREATE TYPE "DailyPlanRole" AS ENUM ('primary', 'secondary', 'optional');

CREATE TABLE "daily_plans" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "workdayStart" TIME(0) NOT NULL,
  "workdayEnd" TIME(0) NOT NULL,
  "status" "DailyPlanStatus" NOT NULL DEFAULT 'draft',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "carryoverSignals" JSONB NOT NULL DEFAULT '[]'::jsonb,
  CONSTRAINT "daily_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_plans_workday_order" CHECK ("workdayStart" < "workdayEnd"),
  CONSTRAINT "daily_plans_version" CHECK ("version" > 0),
  CONSTRAINT "daily_plans_closed_timestamp" CHECK (
    ("status" = 'closed' AND "closedAt" IS NOT NULL) OR
    ("status" <> 'closed' AND "closedAt" IS NULL)
  )
);

CREATE TABLE "daily_plan_items" (
  "id" UUID NOT NULL,
  "dailyPlanId" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "role" "DailyPlanRole" NOT NULL,
  "plannedStart" TIMESTAMPTZ(3),
  "plannedDurationMinutes" INTEGER,
  "position" INTEGER NOT NULL,
  "addedDuringDay" BOOLEAN NOT NULL DEFAULT false,
  "completedDuringDay" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "daily_plan_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "daily_plan_items_duration" CHECK (
    "plannedDurationMinutes" IS NULL OR
    "plannedDurationMinutes" BETWEEN 1 AND 10080
  ),
  CONSTRAINT "daily_plan_items_position" CHECK ("position" >= 0)
);

CREATE UNIQUE INDEX "daily_plans_userId_date_key" ON "daily_plans"("userId", "date");
CREATE INDEX "daily_plans_userId_status_date_idx" ON "daily_plans"("userId", "status", "date");
CREATE UNIQUE INDEX "daily_plan_items_dailyPlanId_taskId_key" ON "daily_plan_items"("dailyPlanId", "taskId");
CREATE INDEX "daily_plan_items_dailyPlanId_position_id_idx" ON "daily_plan_items"("dailyPlanId", "position", "id");
CREATE INDEX "daily_plan_items_taskId_dailyPlanId_idx" ON "daily_plan_items"("taskId", "dailyPlanId");

ALTER TABLE "daily_plans"
  ADD CONSTRAINT "daily_plans_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_plan_items"
  ADD CONSTRAINT "daily_plan_items_dailyPlanId_fkey"
  FOREIGN KEY ("dailyPlanId") REFERENCES "daily_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_plan_items"
  ADD CONSTRAINT "daily_plan_items_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE NO ACTION ON UPDATE CASCADE
  DEFERRABLE INITIALLY DEFERRED;
