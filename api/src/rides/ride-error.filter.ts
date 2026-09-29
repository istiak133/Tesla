import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { RideError, RideErrorCode } from './ride.errors.js';

const STATUS_BY_CODE: Record<RideErrorCode, number> = {
  NOT_FOUND: 404,
  NOT_YOUR_RIDE: 403,
  INVALID_ZONE: 400,
  ACTIVE_RIDE_EXISTS: 409,
  INVALID_TRANSITION: 409,
  ALREADY_TAKEN: 409,
  NO_VEHICLE: 403,
  DRIVER_OFFLINE: 409,
  HAS_ACTIVE_POOL: 409,
  NO_ACTIVE_POOL: 409,
  POOL_NOT_OPEN: 409,
  NOT_COMPATIBLE: 409,
  SEATS_UNAVAILABLE: 409,
  BUSY: 503,
};

/** Turns a RideError into an HTTP response: { statusCode, code, message }. */
@Catch(RideError)
export class RideErrorFilter implements ExceptionFilter {
  catch(error: RideError, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const statusCode = STATUS_BY_CODE[error.code];
    response.status(statusCode).json({
      statusCode,
      code: error.code,
      message: error.message,
    });
  }
}
