import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type AuthenticatedUser,
  type CreateTask,
  createTaskSchema,
  type ListTasksQuery,
  listTasksQuerySchema,
  type Task,
  type TaskHistoryPage,
  type TaskHistoryQuery,
  taskHistoryQuerySchema,
  taskIdParamSchema,
  type TaskPage,
  type TransitionTask,
  transitionTaskSchema,
  type UpdateTask,
  updateTaskSchema,
} from '@execution/contracts';

import { ZodValidationPipe } from '../../common/http/zod-validation.pipe';
import { CsrfOriginGuard } from '../auth/csrf-origin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TasksService } from './tasks.service';

@Controller('tasks')
@UseGuards(SessionAuthGuard)
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly lifecycle: TaskLifecycleService,
  ) {}

  @Post()
  @UseGuards(CsrfOriginGuard)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTaskSchema)) input: CreateTask,
  ): Promise<Task> {
    return this.tasks.create(user.id, input);
  }

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listTasksQuerySchema)) query: ListTasksQuery,
  ): Promise<TaskPage> {
    return this.tasks.list(user.id, query);
  }

  @Get(':id/history')
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
    @Query(new ZodValidationPipe(taskHistoryQuerySchema))
    query: TaskHistoryQuery,
  ): Promise<TaskHistoryPage> {
    return this.tasks.history(user.id, id, query);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
  ): Promise<Task> {
    return this.tasks.get(user.id, id);
  }

  @Patch(':id')
  @UseGuards(CsrfOriginGuard)
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) patch: UpdateTask,
  ): Promise<Task> {
    return this.tasks.update(user.id, id, patch);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(CsrfOriginGuard)
  async delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
  ): Promise<void> {
    await this.tasks.delete(user.id, id);
  }

  @Post(':id/archive')
  @UseGuards(CsrfOriginGuard)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(transitionTaskSchema)) body: TransitionTask,
  ): Promise<Task> {
    return this.lifecycle.transition({
      taskId: id,
      userId: user.id,
      to: 'archived',
      ...(body.reason ? { reason: body.reason } : {}),
    });
  }

  @Post(':id/complete')
  @UseGuards(CsrfOriginGuard)
  complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', new ZodValidationPipe(taskIdParamSchema)) id: string,
    @Body(new ZodValidationPipe(transitionTaskSchema)) body: TransitionTask,
  ): Promise<Task> {
    return this.lifecycle.transition({
      taskId: id,
      userId: user.id,
      to: 'completed',
      ...(body.reason ? { reason: body.reason } : {}),
    });
  }
}
