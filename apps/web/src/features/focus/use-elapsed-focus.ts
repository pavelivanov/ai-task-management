import type { FocusSession } from '@execution/contracts';
import { useEffect, useState } from 'react';

interface TimerAnchor {
  identity: string;
  baseSeconds: number;
  monotonicMilliseconds: number;
  running: boolean;
}

export function elapsedFocusSeconds(
  anchor: TimerAnchor,
  monotonicMilliseconds: number,
): number {
  if (!anchor.running) return anchor.baseSeconds;
  return (
    anchor.baseSeconds +
    Math.max(
      0,
      Math.floor(
        (monotonicMilliseconds - anchor.monotonicMilliseconds) / 1_000,
      ),
    )
  );
}

export function useElapsedFocusSeconds(session: FocusSession): number {
  const identity = `${session.id}:${session.serverNow}:${session.version}`;
  const [elapsed, setElapsed] = useState(session.focusedDurationSeconds);

  useEffect(() => {
    const anchor: TimerAnchor = {
      identity,
      baseSeconds: session.focusedDurationSeconds,
      monotonicMilliseconds: performance.now(),
      running: session.status === 'active',
    };
    if (!anchor.running) return;
    const timer = window.setInterval(
      () => setElapsed(elapsedFocusSeconds(anchor, performance.now())),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [identity, session.focusedDurationSeconds, session.status]);

  return elapsed;
}

export function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}
