import { createHash } from 'node:crypto';

const projectPathPrefix =
  /(?:file:\/\/)?(?:[a-zA-Z]:)?[^()\s]*\/(?=(?:apps|packages|scripts)\/)/g;
const dependencyPathPrefix =
  /(?:file:\/\/)?(?:[a-zA-Z]:)?[^()\s]*\/(?=node_modules\/)/g;

function normalizeStackFrame(frame: string): string {
  return frame
    .trim()
    .replace(/^at\s+/, '')
    .replaceAll('\\', '/')
    .replace(projectPathPrefix, '')
    .replace(dependencyPathPrefix, '');
}

export function fingerprintUnhandledError(exception: unknown): string {
  const stackFrames =
    exception instanceof Error && typeof exception.stack === 'string'
      ? exception.stack
          .split(/\r?\n/)
          .slice(1)
          .map(normalizeStackFrame)
          .filter(Boolean)
      : [];
  const normalizedFrames =
    stackFrames.length > 0
      ? stackFrames.join('\n')
      : `non-error:${typeof exception}`;
  const digest = createHash('sha256')
    .update(normalizedFrames)
    .digest('hex')
    .slice(0, 24);
  return `v1:${digest}`;
}
