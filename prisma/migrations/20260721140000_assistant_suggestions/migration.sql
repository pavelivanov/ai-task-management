CREATE TYPE "BlockReason" AS ENUM (
  'unclear_next_step',
  'too_large',
  'missing_information',
  'fear_of_error',
  'low_value',
  'boring',
  'external_dependency',
  'other'
);

CREATE TYPE "AssistantMessageRole" AS ENUM ('user', 'assistant', 'system');

CREATE TYPE "AiSuggestionType" AS ENUM (
  'task_extraction',
  'daily_plan',
  'task_decomposition',
  'carryover_diagnosis',
  'outcome_summary'
);

CREATE TYPE "AiSuggestionStatus" AS ENUM (
  'queued',
  'running',
  'completed',
  'failed',
  'accepted',
  'rejected',
  'expired'
);

ALTER TABLE "tasks"
  ADD COLUMN "blockReason" "BlockReason",
  ADD COLUMN "blockReasonDetails" TEXT;

CREATE TABLE "conversations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "conversation_messages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "conversationId" UUID NOT NULL,
  "role" "AssistantMessageRole" NOT NULL,
  "content" TEXT NOT NULL,
  "structuredAction" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_suggestions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "conversationId" UUID,
  "type" "AiSuggestionType" NOT NULL,
  "status" "AiSuggestionStatus" NOT NULL,
  "schemaVersion" VARCHAR(40) NOT NULL,
  "promptVersion" VARCHAR(40) NOT NULL,
  "inputContext" JSONB NOT NULL,
  "inputContextHash" CHAR(64) NOT NULL,
  "output" JSONB,
  "provider" VARCHAR(60),
  "model" VARCHAR(120),
  "providerRequestId" VARCHAR(255),
  "usage" JSONB,
  "errorCode" VARCHAR(120),
  "rejectionReason" VARCHAR(120),
  "idempotencyKey" VARCHAR(160),
  "retryCount" INTEGER NOT NULL DEFAULT 0,
  "maxRetries" INTEGER NOT NULL DEFAULT 3,
  "version" INTEGER NOT NULL DEFAULT 1,
  "leaseOwner" VARCHAR(120),
  "leaseExpiresAt" TIMESTAMPTZ(3),
  "nextAttemptAt" TIMESTAMPTZ(3),
  "acceptedAt" TIMESTAMPTZ(3),
  "rejectedAt" TIMESTAMPTZ(3),
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ai_suggestions_retry_bounds" CHECK (
    "retryCount" >= 0 AND "maxRetries" BETWEEN 0 AND 10 AND "version" > 0
  ),
  CONSTRAINT "ai_suggestions_terminal_timestamps" CHECK (
    ("status" <> 'accepted' OR "acceptedAt" IS NOT NULL) AND
    ("status" <> 'rejected' OR "rejectedAt" IS NOT NULL)
  )
);

CREATE INDEX "conversations_userId_updatedAt_id_idx"
  ON "conversations"("userId", "updatedAt", "id");
CREATE INDEX "conversation_messages_userId_conversationId_createdAt_id_idx"
  ON "conversation_messages"("userId", "conversationId", "createdAt", "id");
CREATE UNIQUE INDEX "ai_suggestions_userId_type_idempotencyKey_key"
  ON "ai_suggestions"("userId", "type", "idempotencyKey");
CREATE INDEX "ai_suggestions_userId_status_createdAt_id_idx"
  ON "ai_suggestions"("userId", "status", "createdAt", "id");
CREATE INDEX "ai_suggestions_status_leaseExpiresAt_createdAt_id_idx"
  ON "ai_suggestions"("status", "leaseExpiresAt", "createdAt", "id");
CREATE INDEX "ai_suggestions_expiresAt_idx"
  ON "ai_suggestions"("expiresAt");

ALTER TABLE "conversations"
  ADD CONSTRAINT "conversations_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE;
ALTER TABLE "ai_suggestions"
  ADD CONSTRAINT "ai_suggestions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "ai_suggestions"
  ADD CONSTRAINT "ai_suggestions_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE;
