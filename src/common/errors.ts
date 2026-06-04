import { HttpException, HttpStatus } from '@nestjs/common';

/** Canonical application error codes (see spec §6.1). */
export type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_ALLOWED' // whitelist
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'INTERNAL';

/**
 * Application exception that serializes to the spec's error envelope:
 *   { code, message, details }
 */
export class AppException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  unauthorized: (message = '인증이 필요합니다.', details = {}) =>
    new AppException(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message, details),
  forbidden: (message = '권한이 없습니다.', details = {}) =>
    new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', message, details),
  notAllowed: (message = '등록된 사용자만 이용할 수 있습니다.', details = {}) =>
    new AppException(HttpStatus.FORBIDDEN, 'NOT_ALLOWED', message, details),
  notFound: (message = '대상을 찾을 수 없습니다.', details = {}) =>
    new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', message, details),
  validation: (message = '입력값이 올바르지 않습니다.', details = {}) =>
    new AppException(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', message, details),
  conflict: (message = '이미 처리된 요청입니다.', details = {}) =>
    new AppException(HttpStatus.CONFLICT, 'CONFLICT', message, details),
  rateLimited: (message = '요청이 너무 많습니다.', details = {}) =>
    new AppException(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, details),
  internal: (message = '서버 오류가 발생했습니다.', details = {}) =>
    new AppException(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL', message, details),
};
