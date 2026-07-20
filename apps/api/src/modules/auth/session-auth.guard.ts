import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '@execution/contracts';
import type { Request } from 'express';

import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  currentUser: AuthenticatedUser;
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly cookies: AuthCookieService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.cookies.readSessionToken(request);
    const user = token ? await this.authService.authenticate(token) : null;
    if (!user) {
      throw new UnauthorizedException({
        code: 'AUTH_REQUIRED',
        message: 'Authentication is required.',
      });
    }

    request.currentUser = user;
    return true;
  }
}
