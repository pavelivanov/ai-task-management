import { Injectable } from '@nestjs/common';
import type {
  AssistantSuggestionOutput,
  DailyPlanRole,
} from '@execution/contracts';
import { randomUUID } from 'node:crypto';

import type {
  GenerateStructuredInput,
  LlmProvider,
  LlmProviderResult,
} from './llm-provider';

@Injectable()
export class FakeLlmProvider implements LlmProvider {
  async generateStructured(
    input: GenerateStructuredInput,
  ): Promise<LlmProviderResult> {
    const candidate = this.generate(input);
    return {
      kind: 'success',
      data: input.schema.parse(candidate),
      provider: 'fake',
      model: 'deterministic-v1',
      requestId: randomUUID(),
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  }

  private generate(input: GenerateStructuredInput): AssistantSuggestionOutput {
    switch (input.type) {
      case 'task_extraction': {
        const sourceText = String(input.context.sourceText ?? '');
        const titles = sourceText
          .split(/\s+(?:and|then)\s+|[.;\n]+/i)
          .map((title) => title.trim())
          .filter(Boolean)
          .slice(0, 10);
        return {
          summary: `${titles.length} proposed task${titles.length === 1 ? '' : 's'}`,
          tasks: (titles.length > 0 ? titles : [sourceText]).map((title) => ({
            title: title[0]?.toUpperCase() + title.slice(1),
            category: 'work',
            estimateMinutes: null,
          })),
        };
      }
      case 'task_decomposition': {
        const task = input.context.task as {
          id: string;
          version: number;
          title: string;
          estimateMinutes: number | null;
        };
        const estimate = task.estimateMinutes
          ? Math.max(5, Math.floor(task.estimateMinutes / 3))
          : null;
        return {
          parentTaskId: task.id,
          parentTaskVersion: task.version,
          reason: 'The outcome is easier to start as three concrete steps.',
          subtasks: [
            'Clarify the result',
            'Prepare the materials',
            'Complete and check',
          ].map((step) => ({
            title: `${step}: ${task.title}`,
            estimateMinutes: estimate,
          })),
        };
      }
      case 'daily_plan': {
        const candidates = input.context.candidates as Array<{
          id: string;
          version: number;
          estimateMinutes: number | null;
          carryoverCount: number;
        }>;
        const items = candidates.slice(0, 5).map((task, index) => ({
          taskId: task.id,
          taskVersion: task.version,
          role: (index === 0
            ? 'primary'
            : index < 3
              ? 'secondary'
              : 'optional') as DailyPlanRole,
          plannedDurationMinutes: task.estimateMinutes,
        }));
        return {
          summary: 'A bounded plan with one protected outcome.',
          date: String(input.context.date),
          items,
          warnings: items
            .filter((item) => item.plannedDurationMinutes === null)
            .map((item) => ({
              code: 'missing_estimate' as const,
              taskId: item.taskId,
              message: 'Confirm an estimate before relying on capacity.',
            })),
          explanation:
            'The earliest due and repeatedly carried work is placed first; optional work remains explicitly optional.',
        };
      }
      case 'carryover_diagnosis': {
        const task = input.context.task as { id: string; version: number };
        return {
          taskId: task.id,
          taskVersion: task.version,
          question: 'What is the smallest next step that is still unclear?',
          blockReason: 'unclear_next_step',
          details: 'The next executable action needs clarification.',
        };
      }
      case 'outcome_summary': {
        const review = input.context.review as {
          date: string;
          primaryOutcomeCompleted: boolean;
          focusedMinutes: number;
          completedPlannedTasks: number;
          completedUnplannedTasks: number;
          carriedOverTasks: number;
        };
        return {
          reviewDate: review.date,
          summary: `${review.primaryOutcomeCompleted ? 'The primary outcome was completed' : 'The primary outcome remains open'} with ${review.focusedMinutes} focused minutes, ${review.completedPlannedTasks} planned completions, ${review.completedUnplannedTasks} unplanned completions, and ${review.carriedOverTasks} carried-over tasks.`,
        };
      }
    }
  }
}
