import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest, unauthorizedEvent } from './api-client';

const typedSchema = {
  parse(value: unknown): { value: number } {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('value' in value) ||
      typeof value.value !== 'number'
    ) {
      throw new Error('Invalid data.');
    }
    return { value: value.value };
  },
};

describe('api client boundary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('validates successful data through the supplied contract schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ value: 3 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(apiRequest('/typed', typedSchema)).resolves.toEqual({
      value: 3,
    });
  });

  it('normalizes errors and announces unauthorized cache eviction', async () => {
    const unauthorized = vi.fn();
    window.addEventListener(unauthorizedEvent, unauthorized);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Sign in again.',
            issues: ['session: expired'],
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const result = apiRequest('/private', typedSchema);
    await expect(result).rejects.toMatchObject({
      status: 401,
      code: 'AUTHENTICATION_REQUIRED',
      message: 'Sign in again.',
      issues: ['session: expired'],
    });
    expect(unauthorized).toHaveBeenCalledOnce();
    window.removeEventListener(unauthorizedEvent, unauthorized);
  });
});
