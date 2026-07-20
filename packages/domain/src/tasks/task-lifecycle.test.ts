import { describe, expect, it } from 'vitest';

import {
  TASK_STATUSES,
  TASK_TRANSITION_TARGETS,
  TERMINAL_TASK_STATUSES,
  TaskTransitionError,
  transitionTaskStatus,
  validateTaskDescription,
  validateTaskDueAt,
  validateTaskEstimate,
  validateTaskTitle,
} from './index.js';

const allowedEdges = TASK_STATUSES.flatMap((from) =>
  TASK_TRANSITION_TARGETS[from].map((to) => [from, to] as const),
);

describe('task lifecycle', () => {
  it.each(allowedEdges)('allows %s -> %s', (from, to) => {
    expect(transitionTaskStatus(from, to)).toMatchObject({ from, to });
  });

  it('rejects every no-op and unsupported edge exhaustively', () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        if (TASK_TRANSITION_TARGETS[from].includes(to)) continue;
        expect(() => transitionTaskStatus(from, to)).toThrow(
          TaskTransitionError,
        );
      }
    }
  });

  it('keeps completed, cancelled, and archived states terminal', () => {
    expect(TERMINAL_TASK_STATUSES).toEqual([
      'completed',
      'cancelled',
      'archived',
    ]);
    for (const status of TERMINAL_TASK_STATUSES) {
      expect(TASK_TRANSITION_TARGETS[status]).toEqual([]);
    }
  });

  it('maps lifecycle edges to their append-only event semantics', () => {
    expect(transitionTaskStatus('inbox', 'backlog').eventType).toBe('updated');
    expect(transitionTaskStatus('planned', 'backlog').eventType).toBe(
      'unscheduled',
    );
    expect(transitionTaskStatus('backlog', 'in_progress').eventType).toBe(
      'started',
    );
    expect(transitionTaskStatus('waiting', 'in_progress').eventType).toBe(
      'resumed',
    );
  });
});

describe('task value rules', () => {
  it('normalizes valid task values', () => {
    expect(validateTaskTitle('  Ship it  ')).toBe('Ship it');
    expect(validateTaskDescription('  Context  ')).toBe('Context');
    expect(validateTaskDescription('   ')).toBeNull();
    expect(validateTaskEstimate(30)).toBe(30);
    expect(validateTaskDueAt(new Date('2026-07-21T09:00:00.000Z'))).toEqual(
      new Date('2026-07-21T09:00:00.000Z'),
    );
  });

  it.each([
    () => validateTaskTitle('   '),
    () => validateTaskTitle('x'.repeat(241)),
    () => validateTaskDescription('x'.repeat(10_001)),
    () => validateTaskEstimate(0),
    () => validateTaskEstimate(1.5),
    () => validateTaskEstimate(10_081),
    () => validateTaskDueAt(new Date('invalid')),
  ])('rejects invalid task values', (validate) => {
    expect(validate).toThrow(RangeError);
  });
});
