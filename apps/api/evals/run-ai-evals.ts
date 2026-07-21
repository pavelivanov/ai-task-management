import {
  assistantOutputByType,
  type AssistantSuggestionOutput,
  type DailyPlanSuggestionOutput,
  type TaskDecompositionOutput,
} from '@execution/contracts';
import type { z } from 'zod';

import { FakeLlmProvider } from '../src/modules/assistant/fake-llm.provider';
import { ASSISTANT_PROMPTS } from '../src/modules/assistant/assistant-prompts';
import { evaluationFixtures } from './fixtures';

async function main(): Promise<void> {
  const provider = new FakeLlmProvider();
  let valid = 0;
  let validReferences = 0;
  let usefulDecompositions = 0;
  let unauthorizedMutations = 0;

  for (const fixture of evaluationFixtures) {
    const before = JSON.stringify(fixture.context);
    const prompt = ASSISTANT_PROMPTS[fixture.type];
    const result = await provider.generateStructured({
      type: fixture.type,
      schema: assistantOutputByType[
        fixture.type
      ] as z.ZodType<AssistantSuggestionOutput>,
      schemaName: prompt.schemaName,
      promptVersion: prompt.version,
      instructions: prompt.instructions,
      context: fixture.context,
      timeoutMs: 1_000,
      idempotencyKey: fixture.name,
    });
    if (result.kind !== 'success') {
      throw new Error(`${fixture.name}: provider did not return success.`);
    }
    assistantOutputByType[fixture.type].parse(result.data);
    valid += 1;

    if (JSON.stringify(fixture.context) !== before) unauthorizedMutations += 1;
    if ('dueAt' in result.data) {
      throw new Error(`${fixture.name}: invented deadline field.`);
    }

    if (fixture.type === 'daily_plan') {
      const output = result.data as DailyPlanSuggestionOutput;
      const candidates = fixture.context.candidates as Array<{
        id: string;
        version: number;
      }>;
      const references = new Map(
        candidates.map((candidate) => [candidate.id, candidate.version]),
      );
      if (
        output.items.every(
          (item) => references.get(item.taskId) === item.taskVersion,
        )
      ) {
        validReferences += 1;
      }
    } else if (
      fixture.type === 'task_decomposition' ||
      fixture.type === 'carryover_diagnosis'
    ) {
      const task = fixture.context.task as { id: string; version: number };
      const output = result.data as TaskDecompositionOutput & {
        taskId?: string;
        taskVersion?: number;
      };
      const referencedId = output.parentTaskId ?? output.taskId;
      const referencedVersion = output.parentTaskVersion ?? output.taskVersion;
      if (referencedId === task.id && referencedVersion === task.version) {
        validReferences += 1;
      }
      if (
        fixture.type === 'task_decomposition' &&
        output.subtasks.length >= 2 &&
        output.subtasks.every(
          (subtask) =>
            subtask.estimateMinutes === null ||
            (subtask.estimateMinutes >= 1 && subtask.estimateMinutes <= 10_080),
        )
      ) {
        usefulDecompositions += 1;
      }
    }
  }

  const expectedReferences = evaluationFixtures.filter(
    (fixture) => fixture.type !== 'task_extraction',
  ).length;
  if (
    valid !== 70 ||
    validReferences !== expectedReferences ||
    usefulDecompositions !== 20 ||
    unauthorizedMutations !== 0
  ) {
    throw new Error(
      JSON.stringify({
        valid,
        validReferences,
        expectedReferences,
        usefulDecompositions,
        unauthorizedMutations,
      }),
    );
  }
  process.stdout.write(
    `AI evals passed: ${valid} valid outputs, ${validReferences} valid-reference cases, ${usefulDecompositions} useful decompositions, 0 unauthorized mutations.\n`,
  );
}

void main();
