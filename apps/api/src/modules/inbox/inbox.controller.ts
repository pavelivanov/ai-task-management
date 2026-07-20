import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type CaptureInboxTask,
  captureInboxTaskSchema,
  type ListInboxQuery,
  listInboxQuerySchema,
  type ProcessInboxResult,
  type ProcessInboxTask,
  processInboxTaskSchema,
  type Task,
  taskIdParamSchema,
  type TaskPage,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { InboxService } from './inbox.service';

@Controller('inbox')
@UseGuards(SessionAuthGuard)
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listInboxQuerySchema)) query: ListInboxQuery,
  ): Promise<TaskPage> {
    return this.inbox.list(user.id, query);
  }

  @Post('capture')
  @UseGuards(CsrfOriginGuard)
  capture(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(captureInboxTaskSchema))
    input: CaptureInboxTask,
  ): Promise<Task> {
    return this.inbox.capture(user.id, input);
  }

  @Post(':id/process')
  @UseGuards(CsrfOriginGuard)
  process(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(processInboxTaskSchema))
    input: ProcessInboxTask,
  ): Promise<ProcessInboxResult> {
    return this.inbox.process(user.id, id, input);
  }
}
