import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';
import { MpcErrorCode } from '../errors/mpc-error-codes';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  function mockHost() {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };
    return { host, status, json };
  }

  it('normalizes BadRequestException with code', () => {
    const { host, status, json } = mockHost();
    filter.catch(
      new BadRequestException({
        message: '폐기됨',
        code: MpcErrorCode.WALLET_RETIRED,
      }),
      host as any,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      error: 'Bad Request',
      message: '폐기됨',
      code: 'WALLET_RETIRED',
    });
  });

  it('marks class-validator arrays as VALIDATION_FAILED', () => {
    const { host, json } = mockHost();
    filter.catch(
      new BadRequestException({
        message: ['otp must be a 6-digit code'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host as any,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message: ['otp must be a 6-digit code'],
      }),
    );
  });

  it('normalizes UnauthorizedException', () => {
    const { host, status, json } = mockHost();
    filter.catch(
      new UnauthorizedException({
        message: 'OTP 잠김',
        code: MpcErrorCode.OTP_LOCKED,
      }),
      host as any,
    );

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 401,
        code: 'OTP_LOCKED',
        message: 'OTP 잠김',
      }),
    );
  });

  it('hides unknown errors as Internal Server Error', () => {
    const { host, status, json } = mockHost();
    filter.catch(new Error('boom secret'), host as any);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal server error',
    });
  });
});
