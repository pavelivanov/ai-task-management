import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createExecutionQueryClient } from '../../lib/query-client';
import { RealtimeSync } from './RealtimeSync';

class ControlledEventSource {
  static current: ControlledEventSource | null = null;
  onopen: (() => void) | null = null;
  readonly listeners = new Map<string, EventListener>();

  constructor() {
    ControlledEventSource.current = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type: string) {
    this.listeners.delete(type);
  }

  close() {}
}

describe('SSE reconciliation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    ControlledEventSource.current = null;
  });

  it('refetches focus and today on reconnect and maps invalidation events', () => {
    vi.stubGlobal('EventSource', ControlledEventSource);
    const queryClient = createExecutionQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    render(
      <QueryClientProvider client={queryClient}>
        <RealtimeSync userId="00000000-0000-4000-8000-000000000001" />
      </QueryClientProvider>,
    );

    ControlledEventSource.current?.onopen?.();
    ControlledEventSource.current?.listeners.get('focus.changed')?.(
      new Event('focus.changed'),
    );
    ControlledEventSource.current?.listeners.get('plan.changed')?.(
      new Event('plan.changed'),
    );
    expect(invalidate).toHaveBeenCalledTimes(5);
  });
});
