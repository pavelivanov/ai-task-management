CREATE TYPE "TaskCategory" AS ENUM ('work', 'personal');
CREATE TYPE "TaskStatus" AS ENUM (
  'inbox',
  'backlog',
  'planned',
  'in_progress',
  'waiting',
  'blocked',
  'completed',
  'cancelled',
  'archived'
);
CREATE TYPE "TaskPriority" AS ENUM ('low', 'normal', 'high', 'critical');
CREATE TYPE "TaskEventType" AS ENUM (
  'created',
  'updated',
  'scheduled',
  'unscheduled',
  'started',
  'paused',
  'resumed',
  'waiting',
  'blocked',
  'completed',
  'carried_over',
  'cancelled',
  'archived',
  'estimate_changed',
  'ai_suggestion_accepted'
);

CREATE TABLE "projects" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "normalizedName" VARCHAR(120) NOT NULL,
  "color" VARCHAR(7),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "projects_color" CHECK ("color" IS NULL OR "color" ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE "tasks" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "title" VARCHAR(240) NOT NULL,
  "description" TEXT,
  "category" "TaskCategory" NOT NULL,
  "status" "TaskStatus" NOT NULL,
  "priority" "TaskPriority" NOT NULL DEFAULT 'normal',
  "estimateMinutes" INTEGER,
  "dueAt" TIMESTAMP(3),
  "projectId" UUID,
  "parentTaskId" UUID,
  "carryoverCount" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tasks_estimate_minutes" CHECK ("estimateMinutes" IS NULL OR "estimateMinutes" BETWEEN 1 AND 10080),
  CONSTRAINT "tasks_carryover_count" CHECK ("carryoverCount" >= 0),
  CONSTRAINT "tasks_version" CHECK ("version" > 0),
  CONSTRAINT "tasks_not_own_parent" CHECK ("parentTaskId" IS NULL OR "parentTaskId" <> "id"),
  CONSTRAINT "tasks_completed_timestamp" CHECK (
    ("status" = 'completed' AND "completedAt" IS NOT NULL) OR
    ("status" <> 'completed' AND "completedAt" IS NULL)
  )
);

CREATE TABLE "task_events" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "taskId" UUID NOT NULL,
  "taskVersion" INTEGER NOT NULL,
  "type" "TaskEventType" NOT NULL,
  "metadata" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "task_events_task_version" CHECK ("taskVersion" > 0)
);

CREATE UNIQUE INDEX "projects_userId_normalizedName_key" ON "projects"("userId", "normalizedName");
CREATE INDEX "projects_userId_archivedAt_createdAt_id_idx" ON "projects"("userId", "archivedAt", "createdAt", "id");
CREATE INDEX "tasks_userId_status_createdAt_id_idx" ON "tasks"("userId", "status", "createdAt", "id");
CREATE INDEX "tasks_userId_projectId_status_idx" ON "tasks"("userId", "projectId", "status");
CREATE INDEX "tasks_parentTaskId_idx" ON "tasks"("parentTaskId");
CREATE UNIQUE INDEX "task_events_taskId_taskVersion_key" ON "task_events"("taskId", "taskVersion");
CREATE INDEX "task_events_taskId_createdAt_id_idx" ON "task_events"("taskId", "createdAt", "id");
CREATE INDEX "task_events_userId_createdAt_id_idx" ON "task_events"("userId", "createdAt", "id");

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_parentTaskId_fkey"
  FOREIGN KEY ("parentTaskId") REFERENCES "tasks"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "task_events"
  ADD CONSTRAINT "task_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "task_events"
  ADD CONSTRAINT "task_events_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
