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
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('execution_session'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
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
      sessionCookieName: value.SESSION_COOKIE_NAME,
      sessionTtlDays: value.SESSION_TTL_DAYS,
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
  readonly sessionCookieName!: string;
  readonly sessionTtlDays!: number;

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
