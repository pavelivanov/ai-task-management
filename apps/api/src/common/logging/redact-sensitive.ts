const sensitiveKeys = new Set([
  'access_token',
  'authorization',
  'client_secret',
  'cookie',
  'id_token',
  'refresh_token',
  'set-cookie',
]);

export function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitive);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sensitiveKeys.has(key.toLowerCase())
          ? '[REDACTED]'
          : redactSensitive(entry),
      ]),
    );
  }

  return value;
}
