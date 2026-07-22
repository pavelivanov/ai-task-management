import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  issues?: string[];
  currentSession?: unknown;
  scheduleAfterWorkAt?: unknown;
  retryAfterSeconds?: number;
  checks?: Record<string, unknown>;
}

interface StatusError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
}

function normalizeHttpError(exception: HttpException): ErrorBody {
  const response = exception.getResponse();
  if (typeof response === 'object' && response !== null) {
    const candidate = response as Partial<ErrorBody>;
    if (
      typeof candidate.code === 'string' &&
      typeof candidate.message === 'string'
    ) {
      return {
        code: candidate.code,
        message: candidate.message,
        ...(candidate.issues ? { issues: candidate.issues } : {}),
        ...(candidate.currentSession
          ? { currentSession: candidate.currentSession }
          : {}),
        ...(typeof candidate.scheduleAfterWorkAt === 'string'
          ? { scheduleAfterWorkAt: candidate.scheduleAfterWorkAt }
          : {}),
        ...(typeof candidate.retryAfterSeconds === 'number'
          ? { retryAfterSeconds: candidate.retryAfterSeconds }
          : {}),
        ...(candidate.checks ? { checks: candidate.checks } : {}),
      };
    }
  }

  if (exception.getStatus() === HttpStatus.BAD_REQUEST) {
    return {
      code: 'INVALID_REQUEST',
      message: 'The request could not be parsed.',
    };
  }
  return {
    code: 'REQUEST_FAILED',
    message: 'The request could not be completed.',
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const error = normalizeHttpError(exception);
      response.locals.errorCode = error.code;
      response.status(exception.getStatus()).json(error);
      return;
    }

    const statusError = exception as StatusError;
    const status =
      typeof statusError?.status === 'number'
        ? statusError.status
        : typeof statusError?.statusCode === 'number'
          ? statusError.statusCode
          : null;
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      response.locals.errorCode = 'PAYLOAD_TOO_LARGE';
      response.status(status).json({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'The request body exceeds the configured size limit.',
      });
      return;
    }
    response.locals.errorCode = 'INTERNAL_ERROR';
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  }
}
