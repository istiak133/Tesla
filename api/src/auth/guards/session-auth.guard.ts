import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { toPublicUser } from '../auth.types.js';
import { SESSION_COOKIE_NAME } from '../session-cookie.js';
import { hashSessionToken } from '../session-token.js';
import { SessionsRepository } from '../sessions.repository.js';

/**
 * Lets a request through only if it carries a valid session cookie.
 * On success the logged-in user is attached to the request as request.user.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly sessionsRepository: SessionsRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token: unknown = request.cookies?.[SESSION_COOKIE_NAME];

    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException('Not logged in');
    }

    const user = await this.sessionsRepository.findUserByValidToken(
      hashSessionToken(token),
    );
    if (user === null) {
      throw new UnauthorizedException('Session expired or invalid');
    }

    request.user = toPublicUser(user);
    return true;
  }
}
