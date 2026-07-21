const uuid = (index: number) =>
  `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

export interface EvaluationFixture {
  name: string;
  type:
    | 'task_extraction'
    | 'task_decomposition'
    | 'daily_plan'
    | 'carryover_diagnosis';
  context: Record<string, unknown>;
}

export const taskCaptureFixtures: EvaluationFixture[] = Array.from(
  { length: 20 },
  (_, index) => ({
    name: `capture-${index + 1}`,
    type: 'task_extraction',
    context: {
      sourceText: `Prepare synthetic report ${index + 1} and send synthetic update ${index + 1}`,
    },
  }),
);

export const decompositionFixtures: EvaluationFixture[] = Array.from(
  { length: 20 },
  (_, index) => ({
    name: `decomposition-${index + 1}`,
    type: 'task_decomposition',
    context: {
      task: {
        id: uuid(index + 1),
        version: index + 1,
        title: `Complete synthetic outcome ${index + 1}`,
        estimateMinutes: 30 + index * 5,
      },
    },
  }),
);

export const dailyPlanFixtures: EvaluationFixture[] = Array.from(
  { length: 20 },
  (_, fixtureIndex) => ({
    name: `daily-plan-${fixtureIndex + 1}`,
    type: 'daily_plan',
    context: {
      date: '2026-07-21',
      availableMinutes: 420,
      candidates: Array.from({ length: 6 }, (_, taskIndex) => ({
        id: uuid(100 + fixtureIndex * 10 + taskIndex),
        version: taskIndex + 1,
        title: `Synthetic candidate ${fixtureIndex + 1}.${taskIndex + 1}`,
        estimateMinutes: taskIndex === 5 ? null : 30 + taskIndex * 15,
        carryoverCount: taskIndex % 3,
      })),
    },
  }),
);

export const carryoverDiagnosisFixtures: EvaluationFixture[] = Array.from(
  { length: 10 },
  (_, index) => ({
    name: `carryover-diagnosis-${index + 1}`,
    type: 'carryover_diagnosis',
    context: {
      task: {
        id: uuid(500 + index),
        version: index + 1,
        title: `Synthetic carried task ${index + 1}`,
        carryoverCount: 3 + (index % 3),
      },
    },
  }),
);

export const evaluationFixtures = [
  ...taskCaptureFixtures,
  ...decompositionFixtures,
  ...dailyPlanFixtures,
  ...carryoverDiagnosisFixtures,
];
