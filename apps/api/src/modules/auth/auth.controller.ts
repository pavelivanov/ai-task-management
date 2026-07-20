import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type E2eLogin,
  e2eLoginSchema,
  type OAuthCallbackQuery,
  oauthCallbackQuerySchema,
} from '@execution/contracts';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { AppConfig } from '../../config/app-config.service';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';
import { CsrfOriginGuard } from './csrf-origin.guard';
import { CurrentUser } from './current-user.decorator';
import { SessionAuthGuard } from './session-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly cookies: AuthCookieService,
    private readonly config: AppConfig,
  ) {}

  @Get('google')
  startGoogleLogin(@Res() response: Response): void {
    const secrets = this.cookies.createOAuthSecrets();
    this.cookies.setOAuthCookies(response, secrets);
    response.redirect(this.authService.createAuthorizationUrl(secrets));
  }

  @Get('google/callback')
  async completeGoogleLogin(
    @Query(new ZodValidationPipe(oauthCallbackQuerySchema))
    query: OAuthCallbackQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const { nonce } = this.cookies.readAndValidateOAuthCookies(
      request,
      query.state,
    );
    const result = await this.authService.completeGoogleLogin({
      code: query.code,
      expectedNonce: nonce,
      currentSessionToken: this.cookies.readSessionToken(request),
      metadata: {
        userAgent: request.headers['user-agent'] ?? null,
      },
    });

    this.cookies.clearOAuthCookies(response);
    this.cookies.setSessionCookie(
      response,
      result.sessionToken,
      result.expiresAt,
    );
    response.redirect(303, this.config.webAppUrl);
  }

  @Get('me')
  @UseGuards(SessionAuthGuard)
  getCurrentUser(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Post('e2e/login')
  @UseGuards(CsrfOriginGuard)
  async e2eLogin(
    @Body(new ZodValidationPipe(e2eLoginSchema)) input: E2eLogin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedUser> {
    const result = await this.authService.createE2eSession(input, {
      userAgent: request.headers['user-agent'] ?? null,
    });
    this.cookies.setSessionCookie(
      response,
      result.sessionToken,
      result.expiresAt,
    );
    return result.user;
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(SessionAuthGuard, CsrfOriginGuard)
  async logout(
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const token = this.cookies.readSessionToken(request);
    if (token) await this.authService.revokeSession(token);
    this.cookies.clearSessionCookie(response);
    response.status(204).send();
  }
}
