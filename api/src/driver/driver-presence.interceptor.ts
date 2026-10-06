import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Observable } from 'rxjs';
import { RidesRepository } from '../rides/rides.repository.js';

/**
 * Every driver request marks the driver's app as seen, before the handler runs, so an action
 * such as a no-show is never judged as coming from a silent driver.
 */
@Injectable()
export class DriverPresenceInterceptor implements NestInterceptor {
  constructor(private readonly ridesRepository: RidesRepository) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const user = context.switchToHttp().getRequest<Request>().user;
    if (user !== undefined) {
      await this.ridesRepository.touchDriver(user.id, new Date());
    }
    return next.handle();
  }
}
