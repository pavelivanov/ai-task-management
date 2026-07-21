import { describe, expect, it } from 'vitest';

import {
  carryoverDiagnosisOutputSchema,
  createAssistantSuggestionSchema,
  dailyPlanSuggestionOutputSchema,
  taskExtractionOutputSchema,
} from './index.js';

const taskId = '7f1142d1-beca-46cd-896a-65768a25592e';

describe('assistant contracts', () => {
  it('rejects unknown extraction fields and oversized task sets', () => {
    expect(() =>
      taskExtractionOutputSchema.parse({
        summary: 'Two tasks',
        tasks: [{ title: 'First', category: 'work', estimateMinutes: null }],
        hiddenMutation: true,
      }),
    ).toThrow();
    expect(() =>
      taskExtractionOutputSchema.parse({
        summary: 'Too many',
        tasks: Array.from({ length: 11 }, (_, index) => ({
          title: `Task ${index}`,
          category: 'work',
          estimateMinutes: null,
        })),
      }),
    ).toThrow();
  });

  it('rejects malformed task references and enums', () => {
    expect(() =>
      dailyPlanSuggestionOutputSchema.parse({
        summary: 'Plan',
        date: '2026-07-21',
        items: [
          {
            taskId: 'not-a-uuid',
            taskVersion: 1,
            role: 'primary',
            plannedDurationMinutes: 30,
          },
        ],
        warnings: [],
        explanation: 'Focused plan.',
      }),
    ).toThrow();
    expect(() =>
      carryoverDiagnosisOutputSchema.parse({
        taskId,
        taskVersion: 1,
        question: 'What is blocking progress?',
        blockReason: 'made_up_reason',
        details: 'Needs clarification.',
      }),
    ).toThrow();
  });

  it('accepts only bounded capability request shapes', () => {
    expect(
      createAssistantSuggestionSchema.parse({
        type: 'task_decomposition',
        taskId,
      }),
    ).toEqual({ type: 'task_decomposition', taskId });
    expect(() =>
      createAssistantSuggestionSchema.parse({
        type: 'task_decomposition',
        taskId,
        sourceText: 'Unexpected',
      }),
    ).toThrow();
  });
});
