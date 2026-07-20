import { ConflictException, Injectable } from '@nestjs/common';
import type {
  CaptureInboxTask,
  ListInboxQuery,
  ProcessInboxResult,
  ProcessInboxTask,
  Task,
  TaskPage,
  TaskStatus,
} from '@execution/contracts';

import { DailyPlansService } from '../daily-plans/daily-plans.service';
import { TaskLifecycleService } from '../tasks/task-lifecycle.service';
import { TasksService } from '../tasks/tasks.service';

@Injectable()
export class InboxService {
  constructor(
    private readonly tasks: TasksService,
    private readonly lifecycle: TaskLifecycleService,
    private readonly dailyPlans: DailyPlansService,
  ) {}

  capture(userId: string, input: CaptureInboxTask): Promise<Task> {
    return this.tasks.create(userId, input, 'inbox');
  }

  list(userId: string, query: ListInboxQuery): Promise<TaskPage> {
    return this.tasks.listInbox(userId, query);
  }

  async process(
    userId: string,
    taskId: string,
    input: ProcessInboxTask,
  ): Promise<ProcessInboxResult> {
    const current = await this.tasks.get(userId, taskId);
    if (input.action === 'schedule') {
      return this.dailyPlans.scheduleTask(userId, taskId, {
        ...(input.planDate ? { planDate: input.planDate } : {}),
        role: input.role,
        ...(input.plannedStart !== undefined
          ? { plannedStart: input.plannedStart }
          : {}),
        ...(input.plannedDurationMinutes !== undefined
          ? { plannedDurationMinutes: input.plannedDurationMinutes }
          : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      });
    }
    if (input.action === 'delete') {
      if (current.status !== 'inbox') this.throwInvalidAction();
      await this.tasks.delete(userId, taskId);
      return { deleted: true };
    }

    const targetByAction = {
      accept: 'backlog',
      archive: 'archived',
      cancel: 'cancelled',
    } as const satisfies Record<
      Exclude<ProcessInboxTask['action'], 'delete' | 'schedule'>,
      TaskStatus
    >;
    const target = targetByAction[input.action];
    if (current.status === target) return current;
    if (current.status !== 'inbox') this.throwInvalidAction();

    return this.lifecycle.transition({
      taskId,
      userId,
      to: target,
      ...(input.reason ? { reason: input.reason } : {}),
      metadata: { inboxAction: input.action },
    });
  }

  private throwInvalidAction(): never {
    throw new ConflictException({
      code: 'INVALID_INBOX_ACTION',
      message: 'Inbox processing is only valid for an inbox task.',
    });
  }
}
