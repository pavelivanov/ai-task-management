import { Controller, Get, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';

import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequest } from '../auth/session-auth.guard';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { InvalidationStreamService } from './invalidation-stream.service';

@Controller('events')
@UseGuards(SessionAuthGuard)
export class InvalidationStreamController {
  constructor(private readonly invalidations: InvalidationStreamService) {}

  @Get()
  stream(
    @CurrentUser() user: AuthenticatedRequest['currentUser'],
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    this.invalidations.open(user.id, request, response);
  }
}
