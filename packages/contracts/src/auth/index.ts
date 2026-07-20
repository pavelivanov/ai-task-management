import { z } from 'zod';

export const authenticatedUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
  avatarUrl: z.url().nullable(),
  timezone: z.string().min(1).max(64),
});

export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(32),
});

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  issues: z.array(z.string()).optional(),
});

export type AuthenticatedUser = z.infer<typeof authenticatedUserSchema>;
export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
