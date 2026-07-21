import { z } from 'zod';

export * from './auth/index.js';
export * from './assistant/index.js';
export * from './behavior/index.js';
export * from './daily-plans/index.js';
export * from './focus/index.js';
export * from './inbox/index.js';
export * from './projects/index.js';
export * from './reviews/index.js';
export * from './tasks/index.js';
export * from './users/index.js';

export const healthResponseSchema = z.object({
  service: z.literal('api'),
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
