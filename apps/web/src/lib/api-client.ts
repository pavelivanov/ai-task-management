import type { ApiError as ApiErrorBody } from '@execution/contracts';

interface Schema<T> {
  parse(value: unknown): T;
}

export const apiBaseUrl = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');

export const unauthorizedEvent = 'execution:unauthorized';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: string[];
  readonly details: Record<string, unknown>;

  constructor(
    status: number,
    body: ApiErrorBody,
    details: Record<string, unknown> = {},
  ) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.issues = body.issues ?? [];
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export async function apiRequest<T>(
  path: string,
  schema: Schema<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  if (!response.ok) {
    const candidate = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    const body: ApiErrorBody = {
      code:
        typeof candidate?.code === 'string'
          ? candidate.code
          : `HTTP_${response.status}`,
      message:
        typeof candidate?.message === 'string'
          ? candidate.message
          : 'The request could not be completed.',
      ...(Array.isArray(candidate?.issues) &&
      candidate.issues.every((issue) => typeof issue === 'string')
        ? { issues: candidate.issues }
        : {}),
    };
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(unauthorizedEvent));
    }
    throw new ApiError(response.status, body, candidate ?? {});
  }
  return schema.parse(await response.json());
}

export async function apiCommand(
  path: string,
  init: RequestInit = {},
): Promise<void> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    credentials: 'include',
  });
  if (!response.ok) {
    const candidate = (await response.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (response.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(unauthorizedEvent));
    }
    throw new ApiError(response.status, {
      code:
        typeof candidate?.code === 'string'
          ? candidate.code
          : `HTTP_${response.status}`,
      message:
        typeof candidate?.message === 'string'
          ? candidate.message
          : 'The request could not be completed.',
    });
  }
}

export function jsonBody(value: unknown): Pick<RequestInit, 'body'> {
  return { body: JSON.stringify(value) };
}
