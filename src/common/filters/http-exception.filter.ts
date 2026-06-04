import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ErrorCode } from '../errors';

interface ErrorBody {
  code: ErrorCode;
  message: string;
  details: Record<string, unknown>;
}

const STATUS_CODE_MAP: Record<number, ErrorCode> = {
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

/** Catches everything and emits the canonical error envelope. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ErrorBody = { code: 'INTERNAL', message: '서버 오류가 발생했습니다.', details: {} };

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();

      if (typeof resp === 'object' && resp !== null && 'code' in resp) {
        // Already an AppException envelope.
        const r = resp as Record<string, unknown>;
        body = {
          code: r.code as ErrorCode,
          message: (r.message as string) ?? exception.message,
          details: (r.details as Record<string, unknown>) ?? {},
        };
      } else {
        // Built-in Nest exception (e.g. ValidationPipe) — normalize it.
        const code = STATUS_CODE_MAP[status] ?? 'INTERNAL';
        let message = exception.message;
        const details: Record<string, unknown> = {};
        if (typeof resp === 'object' && resp !== null) {
          const r = resp as Record<string, unknown>;
          if (Array.isArray(r.message)) {
            message = '입력값이 올바르지 않습니다.';
            details.errors = r.message;
          } else if (typeof r.message === 'string') {
            message = r.message;
          }
        }
        body = { code, message, details };
      }
    } else {
      this.logger.error(
        `Unhandled exception: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    }

    if (status >= 500) {
      this.logger.error(`${body.code}: ${body.message}`);
    }

    res.status(status).json(body);
  }
}
