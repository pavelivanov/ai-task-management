import { Inject, Injectable, Optional } from '@nestjs/common';
import { z } from 'zod';

export const APPLICATION_ENVIRONMENT = Symbol('APPLICATION_ENVIRONMENT');

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    DATABASE_URL: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_CALLBACK_URL: z.url(),
    AUTH_ALLOWED_CALLBACK_URLS: z.string().min(1),
    WEB_APP_URL: z.url(),
    WEB_ORIGINS: z.string().min(1),
    E2E_AUTH_ENABLED: z.enum(['true', 'false']).default('false'),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('execution_session'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    ACCOUNT_DELETION_REAUTH_MINUTES: z.coerce
      .number()
      .int()
      .min(1)
      .max(60)
      .default(10),
    REQUEST_BODY_LIMIT_KB: z.coerce.number().int().min(8).max(1024).default(64),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    API_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(10)
      .max(10_000)
      .default(300),
    AUTH_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(300)
      .default(10),
    CARRYOVER_WARNING_COUNT: z.coerce.number().int().min(1).default(2),
    CARRYOVER_DIAGNOSIS_COUNT: z.coerce.number().int().min(2).default(3),
    CARRYOVER_EXPLICIT_CHOICE_COUNT: z.coerce.number().int().min(3).default(5),
    SSE_HEARTBEAT_SECONDS: z.coerce.number().int().min(1).max(60).default(15),
    SSE_MAX_SUBSCRIBERS_PER_USER: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5),
    SSE_MAX_SUBSCRIBERS_TOTAL: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .default(1_000),
    ASSISTANT_PROVIDER: z
      .enum(['disabled', 'fake', 'openai'])
      .default('disabled'),
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPENAI_MODEL: z.string().min(1).max(120).default('gpt-5.6-sol'),
    ASSISTANT_REASONING_EFFORT: z
      .enum(['none', 'low', 'medium', 'high'])
      .default('low'),
    ASSISTANT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(120_000)
      .default(30_000),
    ASSISTANT_RATE_LIMIT_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(10),
    ASSISTANT_MAX_CONCURRENCY_PER_USER: z.coerce
      .number()
      .int()
      .min(1)
      .max(5)
      .default(2),
    ASSISTANT_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30),
    NOTIFICATION_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(90),
    REVOKED_PUSH_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30),
    RETENTION_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(3_600_000),
    ASSISTANT_WORKER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(1_000),
    ASSISTANT_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30),
    BEHAVIOR_SCHEDULER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(300_000)
      .default(60_000),
    NOTIFICATION_WORKER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .default(1_000),
    NOTIFICATION_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(5)
      .max(300)
      .default(30),
    WAITING_SUGGESTION_MINUTES: z.coerce
      .number()
      .int()
      .min(0)
      .max(120)
      .default(5),
    PUSH_PROVIDER: z.enum(['disabled', 'fake', 'web-push']).default('disabled'),
    VAPID_SUBJECT: z.string().min(1).max(320).optional(),
    VAPID_PUBLIC_KEY: z.string().min(1).optional(),
    VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  })
  .transform((value, context) => {
    const allowedCallbackUrls = value.AUTH_ALLOWED_CALLBACK_URLS.split(',')
      .map((url) => url.trim())
      .filter(Boolean);
    const webOrigins = value.WEB_ORIGINS.split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    if (!allowedCallbackUrls.includes(value.GOOGLE_CALLBACK_URL)) {
      context.addIssue({
        code: 'custom',
        message: 'GOOGLE_CALLBACK_URL must be in AUTH_ALLOWED_CALLBACK_URLS.',
        path: ['GOOGLE_CALLBACK_URL'],
      });
      return z.NEVER;
    }
    if (
      value.CARRYOVER_WARNING_COUNT >= value.CARRYOVER_DIAGNOSIS_COUNT ||
      value.CARRYOVER_DIAGNOSIS_COUNT >= value.CARRYOVER_EXPLICIT_CHOICE_COUNT
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Carryover thresholds must be strictly increasing.',
        path: ['CARRYOVER_WARNING_COUNT'],
      });
      return z.NEVER;
    }
    if (value.NODE_ENV === 'production' && value.E2E_AUTH_ENABLED === 'true') {
      context.addIssue({
        code: 'custom',
        message: 'E2E_AUTH_ENABLED cannot be true in production.',
        path: ['E2E_AUTH_ENABLED'],
      });
      return z.NEVER;
    }
    if (value.ASSISTANT_PROVIDER === 'openai' && !value.OPENAI_API_KEY) {
      context.addIssue({
        code: 'custom',
        message: 'OPENAI_API_KEY is required when ASSISTANT_PROVIDER=openai.',
        path: ['OPENAI_API_KEY'],
      });
      return z.NEVER;
    }
    if (
      value.NODE_ENV === 'production' &&
      value.ASSISTANT_PROVIDER === 'fake'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The fake assistant provider cannot run in production.',
        path: ['ASSISTANT_PROVIDER'],
      });
      return z.NEVER;
    }
    if (
      value.PUSH_PROVIDER === 'web-push' &&
      (!value.VAPID_SUBJECT ||
        !value.VAPID_PUBLIC_KEY ||
        !value.VAPID_PRIVATE_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'VAPID subject, public key, and private key are required for web-push.',
        path: ['PUSH_PROVIDER'],
      });
      return z.NEVER;
    }
    if (value.NODE_ENV === 'production' && value.PUSH_PROVIDER === 'fake') {
      context.addIssue({
        code: 'custom',
        message: 'The fake push provider cannot run in production.',
        path: ['PUSH_PROVIDER'],
      });
      return z.NEVER;
    }
    if (value.NODE_ENV !== 'test' && value.WAITING_SUGGESTION_MINUTES < 5) {
      context.addIssue({
        code: 'custom',
        message:
          'Waiting suggestions require at least five minutes outside tests.',
        path: ['WAITING_SUGGESTION_MINUTES'],
      });
      return z.NEVER;
    }

    return {
      nodeEnvironment: value.NODE_ENV,
      port: value.PORT,
      databaseUrl: value.DATABASE_URL,
      googleClientId: value.GOOGLE_CLIENT_ID,
      googleClientSecret: value.GOOGLE_CLIENT_SECRET,
      googleCallbackUrl: value.GOOGLE_CALLBACK_URL,
      allowedCallbackUrls,
      webAppUrl: value.WEB_APP_URL,
      webOrigins,
      e2eAuthEnabled: value.E2E_AUTH_ENABLED === 'true',
      sessionCookieName: value.SESSION_COOKIE_NAME,
      sessionTtlDays: value.SESSION_TTL_DAYS,
      accountDeletionReauthMinutes: value.ACCOUNT_DELETION_REAUTH_MINUTES,
      requestBodyLimitKb: value.REQUEST_BODY_LIMIT_KB,
      trustProxyHops: value.TRUST_PROXY_HOPS,
      apiRateLimitPerMinute: value.API_RATE_LIMIT_PER_MINUTE,
      authRateLimitPerMinute: value.AUTH_RATE_LIMIT_PER_MINUTE,
      carryoverWarningCount: value.CARRYOVER_WARNING_COUNT,
      carryoverDiagnosisCount: value.CARRYOVER_DIAGNOSIS_COUNT,
      carryoverExplicitChoiceCount: value.CARRYOVER_EXPLICIT_CHOICE_COUNT,
      sseHeartbeatSeconds: value.SSE_HEARTBEAT_SECONDS,
      sseMaxSubscribersPerUser: value.SSE_MAX_SUBSCRIBERS_PER_USER,
      sseMaxSubscribersTotal: value.SSE_MAX_SUBSCRIBERS_TOTAL,
      assistantProvider: value.ASSISTANT_PROVIDER,
      openAiApiKey: value.OPENAI_API_KEY,
      openAiModel: value.OPENAI_MODEL,
      assistantReasoningEffort: value.ASSISTANT_REASONING_EFFORT,
      assistantTimeoutMs: value.ASSISTANT_TIMEOUT_MS,
      assistantRateLimitPerMinute: value.ASSISTANT_RATE_LIMIT_PER_MINUTE,
      assistantMaxConcurrencyPerUser: value.ASSISTANT_MAX_CONCURRENCY_PER_USER,
      assistantRetentionDays: value.ASSISTANT_RETENTION_DAYS,
      notificationRetentionDays: value.NOTIFICATION_RETENTION_DAYS,
      revokedPushRetentionDays: value.REVOKED_PUSH_RETENTION_DAYS,
      retentionSweepIntervalMs: value.RETENTION_SWEEP_INTERVAL_MS,
      assistantWorkerIntervalMs: value.ASSISTANT_WORKER_INTERVAL_MS,
      assistantLeaseSeconds: value.ASSISTANT_LEASE_SECONDS,
      behaviorSchedulerIntervalMs: value.BEHAVIOR_SCHEDULER_INTERVAL_MS,
      notificationWorkerIntervalMs: value.NOTIFICATION_WORKER_INTERVAL_MS,
      notificationLeaseSeconds: value.NOTIFICATION_LEASE_SECONDS,
      waitingSuggestionMinutes: value.WAITING_SUGGESTION_MINUTES,
      pushProvider: value.PUSH_PROVIDER,
      vapidSubject: value.VAPID_SUBJECT,
      vapidPublicKey: value.VAPID_PUBLIC_KEY,
      vapidPrivateKey: value.VAPID_PRIVATE_KEY,
    };
  });

export type ApplicationEnvironment = z.input<typeof environmentSchema>;

@Injectable()
export class AppConfig {
  readonly nodeEnvironment!: 'development' | 'test' | 'production';
  readonly port!: number;
  readonly databaseUrl!: string;
  readonly googleClientId!: string;
  readonly googleClientSecret!: string;
  readonly googleCallbackUrl!: string;
  readonly allowedCallbackUrls!: string[];
  readonly webAppUrl!: string;
  readonly webOrigins!: string[];
  readonly e2eAuthEnabled!: boolean;
  readonly sessionCookieName!: string;
  readonly sessionTtlDays!: number;
  readonly accountDeletionReauthMinutes!: number;
  readonly requestBodyLimitKb!: number;
  readonly trustProxyHops!: number;
  readonly apiRateLimitPerMinute!: number;
  readonly authRateLimitPerMinute!: number;
  readonly carryoverWarningCount!: number;
  readonly carryoverDiagnosisCount!: number;
  readonly carryoverExplicitChoiceCount!: number;
  readonly sseHeartbeatSeconds!: number;
  readonly sseMaxSubscribersPerUser!: number;
  readonly sseMaxSubscribersTotal!: number;
  readonly assistantProvider!: 'disabled' | 'fake' | 'openai';
  readonly openAiApiKey!: string | undefined;
  readonly openAiModel!: string;
  readonly assistantReasoningEffort!: 'none' | 'low' | 'medium' | 'high';
  readonly assistantTimeoutMs!: number;
  readonly assistantRateLimitPerMinute!: number;
  readonly assistantMaxConcurrencyPerUser!: number;
  readonly assistantRetentionDays!: number;
  readonly notificationRetentionDays!: number;
  readonly revokedPushRetentionDays!: number;
  readonly retentionSweepIntervalMs!: number;
  readonly assistantWorkerIntervalMs!: number;
  readonly assistantLeaseSeconds!: number;
  readonly behaviorSchedulerIntervalMs!: number;
  readonly notificationWorkerIntervalMs!: number;
  readonly notificationLeaseSeconds!: number;
  readonly waitingSuggestionMinutes!: number;
  readonly pushProvider!: 'disabled' | 'fake' | 'web-push';
  readonly vapidSubject!: string | undefined;
  readonly vapidPublicKey!: string | undefined;
  readonly vapidPrivateKey!: string | undefined;

  constructor(
    @Optional()
    @Inject(APPLICATION_ENVIRONMENT)
    environment: NodeJS.ProcessEnv = process.env,
  ) {
    const parsed = environmentSchema.parse(environment);
    Object.assign(this, parsed);
  }

  get isProduction(): boolean {
    return this.nodeEnvironment === 'production';
  }
}
