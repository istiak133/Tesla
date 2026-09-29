import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PublicUser } from '../auth.types.js';

/** Gives a controller method the logged-in user: `@CurrentUser() user: PublicUser`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PublicUser => {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.user === undefined) {
      // Only happens if the route forgot SessionAuthGuard.
      throw new Error('CurrentUser used on a route without SessionAuthGuard');
    }
    return request.user;
  },
);
