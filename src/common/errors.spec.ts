import { HttpStatus } from '@nestjs/common';
import { AppException, Errors } from './errors';

describe('AppException / Errors', () => {
  it('serializes to the { code, message, details } envelope', () => {
    const ex = new AppException(HttpStatus.FORBIDDEN, 'FORBIDDEN', '권한이 없습니다.', { a: 1 });
    expect(ex.getStatus()).toBe(403);
    expect(ex.getResponse()).toEqual({
      code: 'FORBIDDEN',
      message: '권한이 없습니다.',
      details: { a: 1 },
    });
  });

  it('NOT_ALLOWED maps to 403 with the whitelist code', () => {
    const ex = Errors.notAllowed();
    expect(ex.getStatus()).toBe(403);
    expect((ex.getResponse() as { code: string }).code).toBe('NOT_ALLOWED');
  });

  it('validation maps to 400 VALIDATION_ERROR', () => {
    const ex = Errors.validation();
    expect(ex.getStatus()).toBe(400);
    expect((ex.getResponse() as { code: string }).code).toBe('VALIDATION_ERROR');
  });
});
