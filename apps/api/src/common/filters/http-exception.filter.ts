import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { MpcErrorCode } from '../errors/mpc-error-codes';

type ErrorResponseBody = {
  statusCode: number;
  error: string;
  message: string | string[];
  code?: string;
};

function statusToErrorName(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'Too Many Requests';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'Service Unavailable';
    default:
      return 'Error';
  }
}

/**
 * Normalize Nest/HTTP exceptions to a consistent JSON shape for the web client.
 * Never includes stack traces or secret material.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      let message: string | string[] = exception.message;
      let code: string | undefined;

      if (typeof raw === 'string') {
        message = raw;
      } else if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        if (typeof obj.message === 'string' || Array.isArray(obj.message)) {
          message = obj.message as string | string[];
        }
        if (typeof obj.code === 'string') {
          code = obj.code;
        }
        // class-validator default
        if (Array.isArray(obj.message) && !code) {
          code = MpcErrorCode.VALIDATION_FAILED;
        }
      }

      const body: ErrorResponseBody = {
        statusCode: status,
        error: statusToErrorName(status),
        message,
        ...(code ? { code } : {}),
      };
      return res.status(status).json(body);
    }

    this.logger.error(
      exception instanceof Error ? exception.message : 'Unknown error',
    );
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message: 'Internal server error',
    } satisfies ErrorResponseBody);
  }
}
