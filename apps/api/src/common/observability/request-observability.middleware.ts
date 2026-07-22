import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

import { OperationalMetrics } from './operational-metrics.service';
import { StructuredLogger } from './structured-logger.service';

const requestIdPattern =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[0-9a-f]{32})$/i;

function routeTemplate(request: Request): string {
  const route = request.route as { path?: unknown } | undefined;
  const suffix = typeof route?.path === 'string' ? route.path : '';
  const template = `${request.baseUrl}${suffix}` || 'unmatched';
  return template.startsWith('/') ? template : 'unmatched';
}

export function requestObservabilityMiddleware(
  logger: StructuredLogger,
  metrics: OperationalMetrics,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const receivedRequestId = request.get('x-request-id');
    const requestId =
      receivedRequestId && requestIdPattern.test(receivedRequestId)
        ? receivedRequestId
        : randomUUID();
    const startedAt = performance.now();
    response.setHeader('x-request-id', requestId);
    response.locals.requestId = requestId;

    response.once('finish', () => {
      const durationMs = Math.max(0, Math.round(performance.now() - startedAt));
      const route = routeTemplate(request);
      metrics.recordRequest({
        method: request.method,
        route,
        statusCode: response.statusCode,
        durationMs,
      });
      logger.info('http.request.completed', {
        requestId,
        method: request.method,
        route,
        status: response.statusCode,
        durationMs,
        ...(typeof response.locals.errorCode === 'string'
          ? { errorCode: response.locals.errorCode }
          : {}),
        ...(route.startsWith('/assistant/') &&
        typeof request.params?.id === 'string' &&
        /^[0-9a-f-]{36}$/i.test(request.params.id)
          ? { suggestionId: request.params.id }
          : {}),
      });
    });
    next();
  };
}
