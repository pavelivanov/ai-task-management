CREATE TYPE "AssistantTriggerType" AS ENUM (
  'morning_plan_missing',
  'estimate_exceeded',
  'task_repeatedly_carried',
  'current_task_waiting',
  'end_of_day_review',
  'plan_over_capacity',
  'deadline_risk'
);

CREATE TYPE "AssistantTriggerStatus" AS ENUM ('eligible', 'fired', 'resolved');

CREATE TYPE "NotificationType" AS ENUM (
  'morning_plan',
  'estimate_exceeded',
  'repeated_carryover',
  'current_task_waiting',
  'end_of_day_review',
  'plan_over_capacity',
  'deadline_risk'
);

CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
  'pending',
  'sending',
  'retry',
  'sent',
  'failed',
  'skipped'
);

ALTER TABLE "focus_sessions"
  ADD COLUMN "expectedWaitMinutes" INTEGER;

ALTER TABLE "daily_reviews"
  ADD COLUMN "estimatedFocusMinutes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "estimateVarianceMinutes" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "focus_sessions"
  ADD CONSTRAINT "focus_sessions_expected_wait_check"
  CHECK ("expectedWaitMinutes" IS NULL OR "expectedWaitMinutes" BETWEEN 5 AND 1440);

CREATE TABLE "assistant_triggers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "type" "AssistantTriggerType" NOT NULL,
  "status" "AssistantTriggerStatus" NOT NULL DEFAULT 'eligible',
  "relatedTaskId" UUID,
  "relatedDate" DATE,
  "dedupeKey" VARCHAR(255) NOT NULL,
  "eligibleAt" TIMESTAMPTZ(3) NOT NULL,
  "firedAt" TIMESTAMPTZ(3),
  "resolvedAt" TIMESTAMPTZ(3),
  "outcome" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "assistant_triggers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notifications" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "assistantTriggerId" UUID,
  "relatedTaskId" UUID,
  "type" "NotificationType" NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "body" VARCHAR(500) NOT NULL,
  "deepLink" VARCHAR(512) NOT NULL,
  "dedupeKey" VARCHAR(255) NOT NULL,
  "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
  "sentAt" TIMESTAMPTZ(3),
  "readAt" TIMESTAMPTZ(3),
  "deliveryStatus" "NotificationDeliveryStatus" NOT NULL DEFAULT 'pending',
  "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "nextAttemptAt" TIMESTAMPTZ(3),
  "leaseOwner" VARCHAR(120),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "push_subscriptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "endpoint" TEXT NOT NULL,
  "endpointFingerprint" CHAR(64) NOT NULL,
  "p256dh" TEXT NOT NULL,
  "authSecret" TEXT NOT NULL,
  "expirationTime" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_triggers_userId_dedupeKey_key"
  ON "assistant_triggers"("userId", "dedupeKey");
CREATE INDEX "assistant_triggers_userId_status_eligibleAt_id_idx"
  ON "assistant_triggers"("userId", "status", "eligibleAt", "id");
CREATE INDEX "assistant_triggers_type_eligibleAt_idx"
  ON "assistant_triggers"("type", "eligibleAt");

CREATE UNIQUE INDEX "notifications_userId_dedupeKey_key"
  ON "notifications"("userId", "dedupeKey");
CREATE INDEX "notifications_userId_readAt_createdAt_id_idx"
  ON "notifications"("userId", "readAt", "createdAt", "id");
CREATE INDEX "notifications_deliveryStatus_scheduledAt_nextAttemptAt_leaseExpiresAt_idx"
  ON "notifications"("deliveryStatus", "scheduledAt", "nextAttemptAt", "leaseExpiresAt");

CREATE UNIQUE INDEX "push_subscriptions_endpointFingerprint_key"
  ON "push_subscriptions"("endpointFingerprint");
CREATE INDEX "push_subscriptions_userId_revokedAt_lastUsedAt_idx"
  ON "push_subscriptions"("userId", "revokedAt", "lastUsedAt");

ALTER TABLE "assistant_triggers"
  ADD CONSTRAINT "assistant_triggers_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "assistant_triggers_relatedTaskId_fkey"
  FOREIGN KEY ("relatedTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_assistantTriggerId_fkey"
  FOREIGN KEY ("assistantTriggerId") REFERENCES "assistant_triggers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "notifications_relatedTaskId_fkey"
  FOREIGN KEY ("relatedTaskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "push_subscriptions"
  ADD CONSTRAINT "push_subscriptions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
