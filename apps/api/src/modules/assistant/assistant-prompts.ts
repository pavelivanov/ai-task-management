import type { AssistantSuggestionType } from '@execution/contracts';

interface AssistantPrompt {
  version: string;
  schemaVersion: string;
  schemaName: string;
  instructions: string;
}

export const ASSISTANT_PROMPTS: Record<
  AssistantSuggestionType,
  AssistantPrompt
> = {
  task_extraction: {
    version: 'task-extraction-v1',
    schemaVersion: 'task-extraction-v1',
    schemaName: 'task_extraction',
    instructions:
      'Extract one to ten concrete tasks from the supplied text. Preserve the user’s meaning. Do not invent deadlines, projects, people, or facts. Return only the required structured output.',
  },
  daily_plan: {
    version: 'daily-plan-v1',
    schemaVersion: 'daily-plan-v1',
    schemaName: 'daily_plan_suggestion',
    instructions:
      'Propose a realistic daily plan using only candidate task IDs and versions in the supplied context. Prefer one primary and at most two secondary commitments, respect available minutes, and explain any exception. Do not mutate tasks or invent deadlines. Return only the required structured output.',
  },
  task_decomposition: {
    version: 'task-decomposition-v1',
    schemaVersion: 'task-decomposition-v1',
    schemaName: 'task_decomposition',
    instructions:
      'Break the supplied task into two to twelve concrete, independently completable subtasks. Preserve the exact parent ID and version. Use plausible estimates or null when evidence is insufficient. Do not invent deadlines or external facts. Return only the required structured output.',
  },
  carryover_diagnosis: {
    version: 'carryover-diagnosis-v1',
    schemaVersion: 'carryover-diagnosis-v1',
    schemaName: 'carryover_diagnosis',
    instructions:
      'Ask one focused question and propose one structured blocker category for the repeatedly carried task. Preserve the exact task ID and version. Do not diagnose a person or make unsupported claims. Return only the required structured output.',
  },
  outcome_summary: {
    version: 'outcome-summary-v1',
    schemaVersion: 'outcome-summary-v1',
    schemaName: 'outcome_summary',
    instructions:
      'Summarize outcomes using only the deterministic daily-review metrics and optional reflection provided. Do not assign a productivity score, invent causes, or add facts. Focus on completed outcomes, focused time, and explicit carryover. Return only the required structured output.',
  },
};
