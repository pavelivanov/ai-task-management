CREATE TYPE "AuthProvider" AS ENUM ('google');
CREATE TYPE "AiInterruptionLevel" AS ENUM ('minimal', 'balanced', 'proactive');

CREATE TABLE "users" (
  "id" UUID NOT NULL,
  "email" VARCHAR(320) NOT NULL,
  "displayName" VARCHAR(160),
  "avatarUrl" VARCHAR(2048),
  "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
  "disabledAt" TIMESTAMP(3),
  "deletionRequestedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_preferences" (
  "userId" UUID NOT NULL,
  "workdayStart" TIME(0) NOT NULL DEFAULT '09:00:00',
  "workdayEnd" TIME(0) NOT NULL DEFAULT '17:00:00',
  "primaryTaskLimit" INTEGER NOT NULL DEFAULT 1,
  "secondaryTaskLimit" INTEGER NOT NULL DEFAULT 2,
  "capacityWarningPercent" INTEGER NOT NULL DEFAULT 10,
  "protectedHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
  "protectedHoursStart" TIME(0),
  "protectedHoursEnd" TIME(0),
  "notificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
  "morningPlanningReminder" BOOLEAN NOT NULL DEFAULT false,
  "endOfDayReminder" BOOLEAN NOT NULL DEFAULT false,
  "aiInterruptionLevel" "AiInterruptionLevel" NOT NULL DEFAULT 'minimal',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "user_preferences_workday_order" CHECK ("workdayStart" < "workdayEnd"),
  CONSTRAINT "user_preferences_primary_limit" CHECK ("primaryTaskLimit" BETWEEN 1 AND 5),
  CONSTRAINT "user_preferences_secondary_limit" CHECK ("secondaryTaskLimit" BETWEEN 0 AND 10),
  CONSTRAINT "user_preferences_capacity_warning" CHECK ("capacityWarningPercent" BETWEEN 0 AND 100),
  CONSTRAINT "user_preferences_protected_hours" CHECK (
    (NOT "protectedHoursEnabled") OR
    ("protectedHoursStart" IS NOT NULL AND "protectedHoursEnd" IS NOT NULL AND "protectedHoursStart" < "protectedHoursEnd")
  )
);

CREATE TABLE "auth_identities" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerSubject" VARCHAR(255) NOT NULL,
  "emailAtLink" VARCHAR(320) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "auth_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "userAgent" VARCHAR(512),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_disabledAt_idx" ON "users"("disabledAt");
CREATE UNIQUE INDEX "auth_identities_provider_providerSubject_key" ON "auth_identities"("provider", "providerSubject");
CREATE INDEX "auth_identities_userId_idx" ON "auth_identities"("userId");
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");
CREATE INDEX "auth_sessions_userId_revokedAt_expiresAt_idx" ON "auth_sessions"("userId", "revokedAt", "expiresAt");
CREATE INDEX "auth_sessions_expiresAt_idx" ON "auth_sessions"("expiresAt");

ALTER TABLE "user_preferences"
  ADD CONSTRAINT "user_preferences_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_identities"
  ADD CONSTRAINT "auth_identities_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
