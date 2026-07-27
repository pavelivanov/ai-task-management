import type { StructuredLogger } from '../observability/structured-logger.service';

interface SafeBackgroundTaskOptions {
  failureEvent: string;
  logger: Pick<StructuredLogger, 'errorEvent'>;
  onFailure?: () => void;
  task: () => Promise<unknown>;
}

export async function runSafeBackgroundTask(
  options: SafeBackgroundTaskOptions,
): Promise<void> {
  try {
    await options.task();
  } catch (error) {
    options.onFailure?.();
    options.logger.errorEvent(options.failureEvent, { error });
  }
}
