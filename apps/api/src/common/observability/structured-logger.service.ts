import { Injectable, type LoggerService } from '@nestjs/common';

import { AppConfig } from '../../config/app-config.service';

type LogLevel = 'debug' | 'error' | 'info' | 'warn';

const sensitiveKey =
  /authorization|cookie|secret|token|password|api.?key|prompt|context|body|email|title|description|endpoint|p256dh|auth/i;
const bearerValue = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const providerToken = /\b(?:sk|ghp|xox[baprs])-[A-Za-z0-9_-]{8,}\b/gi;

function sanitizeString(value: string): string {
  return value
    .replace(bearerValue, '[REDACTED]')
    .replace(providerToken, '[REDACTED]');
}

function safeComponent(context?: string): string | undefined {
  return context && /^[a-zA-Z0-9_.:-]{1,120}$/.test(context)
    ? context
    : undefined;
}

function sanitize(value: unknown, key = ''): unknown {
  if (sensitiveKey.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null)
    return value;
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => sanitize(item));
  if (value instanceof Error) {
    return { name: value.name };
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([entryKey, entryValue]) => [
          entryKey,
          sanitize(entryValue, entryKey),
        ]),
    );
  }
  return String(value);
}

export function serializeLogRecord(record: Record<string, unknown>): string {
  return JSON.stringify(sanitize(record));
}

@Injectable()
export class StructuredLogger implements LoggerService {
  constructor(private readonly config: AppConfig) {}

  info(event: string, fields: Record<string, unknown> = {}): void {
    this.write('info', event, fields);
  }

  log(message: unknown, context?: string): void {
    this.write('info', 'application.log', {
      messageType: typeof message,
      component: safeComponent(context),
    });
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', 'application.warn', {
      messageType: typeof message,
      component: safeComponent(context),
    });
  }

  error(message: unknown, trace?: string, context?: string): void {
    this.write('error', 'application.error', {
      messageType: typeof message,
      ...(trace ? { errorName: 'Error' } : {}),
      component: safeComponent(context),
    });
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', 'application.debug', {
      messageType: typeof message,
      component: safeComponent(context),
    });
  }

  verbose(message: unknown, context?: string): void {
    this.debug(message, context);
  }

  private write(
    level: LogLevel,
    event: string,
    fields: Record<string, unknown>,
  ): void {
    if (this.config.logLevel === 'silent') return;
    if (this.config.logLevel === 'error' && level !== 'error') return;
    const line = `${serializeLogRecord({
      timestamp: new Date().toISOString(),
      level,
      service: 'api',
      event,
      ...fields,
    })}\n`;
    if (level === 'error') process.stderr.write(line);
    else process.stdout.write(line);
  }
}
