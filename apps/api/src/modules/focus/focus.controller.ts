import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type CompleteFocusSession,
  completeFocusSessionSchema,
  type CurrentFocusSession,
  type FocusReason,
  focusReasonSchema,
  type FocusSession,
  focusSessionIdParamSchema,
  type StartFocusSession,
  startFocusSessionSchema,
  type StopFocusSession,
  stopFocusSessionSchema,
} from '@execution/contracts';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { FocusService } from './focus.service';

@Controller('focus')
@UseGuards(SessionAuthGuard)
export class FocusController {
  constructor(private readonly focus: FocusService) {}

  @Get('current')
  async current(
    @CurrentUser() user: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const current: CurrentFocusSession = await this.focus.current(user.id);
    response.status(200).json(current);
  }

  @Post('start')
  @UseGuards(CsrfOriginGuard)
  start(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(startFocusSessionSchema))
    input: StartFocusSession,
  ): Promise<FocusSession> {
    return this.focus.start(user.id, input);
  }

  @Post(':sessionId/pause')
  @UseGuards(CsrfOriginGuard)
  pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ZodValidationPipe(focusSessionIdParamSchema))
    sessionId: string,
    @Body(new ZodValidationPipe(focusReasonSchema)) input: FocusReason,
  ): Promise<FocusSession> {
    return this.focus.pause(user.id, sessionId, input);
  }

  @Post(':sessionId/resume')
  @UseGuards(CsrfOriginGuard)
  resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ZodValidationPipe(focusSessionIdParamSchema))
    sessionId: string,
  ): Promise<FocusSession> {
    return this.focus.resume(user.id, sessionId);
  }

  @Post(':sessionId/wait')
  @UseGuards(CsrfOriginGuard)
  wait(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ZodValidationPipe(focusSessionIdParamSchema))
    sessionId: string,
    @Body(new ZodValidationPipe(focusReasonSchema)) input: FocusReason,
  ): Promise<FocusSession> {
    return this.focus.wait(user.id, sessionId, input);
  }

  @Post(':sessionId/block')
  @UseGuards(CsrfOriginGuard)
  block(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ZodValidationPipe(focusSessionIdParamSchema))
    sessionId: string,
    @Body(new ZodValidationPipe(focusReasonSchema)) input: FocusReason,
  ): Promise<FocusSession> {
    return this.focus.block(user.id, sessionId, input);
  }

  @Post(':sessionId/complete')
  @UseGuards(CsrfOriginGuard)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ZodValidationPipe(focusSessionIdParamSchema))
    sessionId: string,
    @Body(new ZodValidationPipe(completeFocusSessionSchema))
    input: CompleteFocusSession,
  ): Promise<FocusSession> {
    return this.focus.complete(user.id, sessionId, input);
  }

  @Post(':sessionId/stop')
  @UseGuards(CsrfOriginGuard)
  stop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId', new ZodValidationPipe(focusSessionIdParamSchema))
    sessionId: string,
    @Body(new ZodValidationPipe(stopFocusSessionSchema))
    input: StopFocusSession,
  ): Promise<FocusSession> {
    return this.focus.stop(user.id, sessionId, input);
  }
}
