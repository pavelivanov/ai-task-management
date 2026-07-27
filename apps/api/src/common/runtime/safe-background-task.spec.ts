import { runSafeBackgroundTask } from './safe-background-task';

describe('runSafeBackgroundTask', () => {
  it('contains a rejection, records a bounded failure, and allows recovery', async () => {
    const failure = jest.fn();
    const logger = { errorEvent: jest.fn() };
    const task = jest
      .fn<Promise<void>, []>()
      .mockRejectedValueOnce(new Error('provider secret must stay hidden'))
      .mockResolvedValueOnce();

    await expect(
      runSafeBackgroundTask({
        failureEvent: 'worker.loop_failed',
        logger,
        onFailure: failure,
        task,
      }),
    ).resolves.toBeUndefined();
    await expect(
      runSafeBackgroundTask({
        failureEvent: 'worker.loop_failed',
        logger,
        onFailure: failure,
        task,
      }),
    ).resolves.toBeUndefined();

    expect(task).toHaveBeenCalledTimes(2);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(logger.errorEvent).toHaveBeenCalledWith('worker.loop_failed', {
      error: expect.any(Error),
    });
  });
});
