import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  type AuthenticatedUser,
  type UpdateUserPreferences,
  type UserPreferences,
  updateUserPreferencesSchema,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { PreferencesService } from './preferences.service';

@Controller('users/me/preferences')
@UseGuards(SessionAuthGuard)
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  getPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UserPreferences> {
    return this.preferences.getForUser(user.id);
  }

  @Patch()
  @UseGuards(CsrfOriginGuard)
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateUserPreferencesSchema))
    patch: UpdateUserPreferences,
  ): Promise<UserPreferences> {
    return this.preferences.updateForUser(user.id, patch);
  }
}
