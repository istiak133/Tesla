import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { RealtimeService } from './realtime.service.js';

/**
 * After a passenger or driver action succeeds, tell every open screen that requests and
 * rides may have changed (D-020). It runs when the handler has returned, which is after
 * its transaction committed, so a screen that fetches again sees the new state.
 * Reads (GET) change nothing and publish nothing; a failed action publishes nothing.
 */
@Injectable()
export class PublishChangesInterceptor implements NestInterceptor {
  constructor(private readonly realtime: RealtimeService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const method = context.switchToHttp().getRequest<Request>().method;
    if (method === 'GET') {
      return next.handle();
    }
    return next
      .handle()
      .pipe(tap(() => this.realtime.publish(['requests', 'rides'])));
  }
}
