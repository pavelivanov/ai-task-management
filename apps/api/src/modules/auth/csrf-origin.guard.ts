import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

import { AppConfig } from '../../config/app-config.service';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfOriginGuard implements CanActivate {
  constructor(private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    if (safeMethods.has(request.method)) return true;

    const origin = request.headers.origin;
    if (!origin || !this.config.webOrigins.includes(origin)) {
      throw new ForbiddenException({
        code: 'CSRF_ORIGIN_REJECTED',
        message: 'The request origin is not allowed.',
      });
    }
    return true;
  }
}
