import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Req,
  Res,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type DeleteAccount,
  deleteAccountSchema,
} from '@execution/contracts';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AuthCookieService } from '../auth/auth-cookie.service';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { AccountDeletionService } from './account-deletion.service';

@Controller('users/me')
@UseGuards(SessionAuthGuard)
export class AccountController {
  constructor(
    private readonly accounts: AccountDeletionService,
    private readonly cookies: AuthCookieService,
  ) {}

  @Delete()
  @HttpCode(204)
  @UseGuards(CsrfOriginGuard)
  async deleteAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(deleteAccountSchema)) input: DeleteAccount,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const sessionToken = this.cookies.readSessionToken(request);
    if (!sessionToken) {
      throw new ForbiddenException({
        code: 'ACCOUNT_REAUTHENTICATION_REQUIRED',
        message: 'Sign in again before deleting the account.',
      });
    }
    await this.accounts.deleteAccount(user.id, sessionToken, input);
    this.cookies.clearSessionCookie(response);
    response.status(204).send();
  }
}
