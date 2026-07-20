import { describe, expect, it } from 'vitest';

import {
  createTaskSchema,
  listTasksQuerySchema,
  updateTaskSchema,
} from './index.js';

describe('task contracts', () => {
  it('normalizes defaults while preserving explicit nullable values', () => {
    expect(createTaskSchema.parse({ title: '  Ship milestone  ' })).toEqual({
      title: 'Ship milestone',
      category: 'work',
      priority: 'normal',
    });
    expect(
      createTaskSchema.parse({
        title: 'Task',
        description: null,
        estimateMinutes: null,
      }),
    ).toMatchObject({ description: null, estimateMinutes: null });
  });

  it.each([
    { title: '' },
    { title: 'x'.repeat(241) },
    { title: 'Task', estimateMinutes: 0 },
    { title: 'Task', dueAt: 'tomorrow' },
    { title: 'Task', status: 'completed' },
    { title: 'Task', userId: '3699d9cb-829f-47a9-9246-02c7b60718e8' },
  ])('rejects invalid or authority-bearing task input: %j', (input) => {
    expect(() => createTaskSchema.parse(input)).toThrow();
  });

  it('forbids direct lifecycle patches and empty updates', () => {
    expect(() => updateTaskSchema.parse({ status: 'completed' })).toThrow();
    expect(() => updateTaskSchema.parse({})).toThrow();
  });

  it('bounds pagination input', () => {
    expect(listTasksQuerySchema.parse({ limit: '100' }).limit).toBe(100);
    expect(() => listTasksQuerySchema.parse({ limit: '101' })).toThrow();
  });
});
