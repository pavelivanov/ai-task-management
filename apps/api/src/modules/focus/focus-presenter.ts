import type { FocusSession as FocusSessionContract } from '@execution/contracts';
import { focusedDurationMilliseconds } from '@execution/domain';

import type { Prisma } from '../../generated/prisma/client';
import { toTaskContract } from '../tasks/task-presenter';

export type StoredFocusSession = Prisma.FocusSessionGetPayload<{
  include: { segments: true; task: true };
}>;

export function toFocusSessionContract(
  session: StoredFocusSession,
  now: Date,
): FocusSessionContract {
  const focusedDurationSeconds = Math.floor(
    focusedDurationMilliseconds(session.segments, now) / 1_000,
  );
  const activeSegment = session.segments.find(
    (segment) => segment.type === 'focused' && segment.endedAt === null,
  );
  return {
    id: session.id,
    taskId: session.taskId,
    status: session.status,
    version: session.version,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    initialIntent: session.initialIntent,
    outcome: session.outcome,
    interruptionReason: session.interruptionReason,
    expectedWaitMinutes: session.expectedWaitMinutes,
    focusedDurationSeconds,
    activeSegmentStartedAt: activeSegment?.startedAt.toISOString() ?? null,
    serverNow: now.toISOString(),
    segments: session.segments.map((segment) => ({
      id: segment.id,
      sequence: segment.sequence,
      type: segment.type,
      startedAt: segment.startedAt.toISOString(),
      endedAt: segment.endedAt?.toISOString() ?? null,
    })),
    task: toTaskContract(session.task),
  };
}

export function safeCurrentSessionSummary(session: {
  id: string;
  taskId: string;
  status: string;
  version: number;
  startedAt: Date;
}) {
  return {
    id: session.id,
    taskId: session.taskId,
    status: session.status,
    version: session.version,
    startedAt: session.startedAt.toISOString(),
  };
}
