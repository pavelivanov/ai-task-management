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
      };
    }
  }

  return {
    code: 'REQUEST_FAILED',
    message: exception.message,
  };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      response
        .status(exception.getStatus())
        .json(normalizeHttpError(exception));
      return;
    }

    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    });
  }
}
