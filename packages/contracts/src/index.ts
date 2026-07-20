import { z } from 'zod';

export * from './auth/index.js';
export * from './users/index.js';

export const healthResponseSchema = z.object({
  service: z.literal('api'),
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
