import type { AppConfig } from '../../config/app-config.service';
import {
  serializeLogRecord,
  StructuredLogger,
} from './structured-logger.service';

describe('serializeLogRecord', () => {
  it('keeps operational fields and removes sensitive fields and token shapes', () => {
    const output = serializeLogRecord({
      event: 'http.request.completed',
      requestId: 'request-123',
      route: '/tasks/:id',
      taskBody: 'PRIVATE_TASK_CANARY',
      authorization: 'Bearer PRIVATE_BEARER_CANARY',
      nested: { apiKey: ['sk', 'PRIVATE_PROVIDER_CANARY'].join('-') },
      accidental: 'Bearer PRIVATE_INLINE_CANARY',
    });

    expect(output).toContain('request-123');
    expect(output).toContain('/tasks/:id');
    expect(output).not.toContain('PRIVATE_TASK_CANARY');
    expect(output).not.toContain('PRIVATE_BEARER_CANARY');
    expect(output).not.toContain('PRIVATE_PROVIDER_CANARY');
    expect(output).not.toContain('PRIVATE_INLINE_CANARY');
  });

  it('does not serialize exception messages or stacks', () => {
    const output = serializeLogRecord({
      error: new Error('PRIVATE_ERROR_CANARY'),
    });

    expect(output).toContain('Error');
    expect(output).not.toContain('PRIVATE_ERROR_CANARY');
  });

  it('does not pass arbitrary framework messages to the output sink', () => {
    const write = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const logger = new StructuredLogger({ logLevel: 'info' } as AppConfig);

    logger.log('PRIVATE_FRAMEWORK_MESSAGE_CANARY', 'TestContext');

    expect(write).toHaveBeenCalledTimes(1);
    expect(String(write.mock.calls[0]?.[0])).toContain('TestContext');
    expect(String(write.mock.calls[0]?.[0])).not.toContain(
      'PRIVATE_FRAMEWORK_MESSAGE_CANARY',
    );
    write.mockRestore();
  });
});
