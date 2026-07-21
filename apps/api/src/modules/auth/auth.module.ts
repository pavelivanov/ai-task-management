import { Module } from '@nestjs/common';

import { AppConfigModule } from '../../config/app-config.module';
import { DatabaseModule } from '../../database/database.module';
import { AuthController } from './auth.controller';
import { AuthCookieService } from './auth-cookie.service';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthService } from './auth.service';
import { CLOCK, SystemClock } from './clock';
import { CsrfOriginGuard } from './csrf-origin.guard';
import { GoogleIdentityProvider } from './google-identity-provider';
import { IDENTITY_PROVIDER } from './identity-provider';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionCleanupScheduler } from './session-cleanup.scheduler';

@Module({
  imports: [AppConfigModule, DatabaseModule],
  controllers: [AuthController],
  providers: [
    AuthCookieService,
    AuthRateLimitGuard,
    AuthService,
    CsrfOriginGuard,
    SessionAuthGuard,
    SessionCleanupScheduler,
    { provide: CLOCK, useClass: SystemClock },
    { provide: IDENTITY_PROVIDER, useClass: GoogleIdentityProvider },
  ],
  exports: [
    AuthCookieService,
    AuthService,
    CLOCK,
    CsrfOriginGuard,
    SessionAuthGuard,
    SessionCleanupScheduler,
  ],
})
export class AuthModule {}
