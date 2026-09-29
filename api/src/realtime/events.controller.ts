import {
  Controller,
  Header,
  MessageEvent,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { filter, interval, map, merge, Observable } from 'rxjs';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard.js';
import { RealtimeService, topicsFor } from './realtime.service.js';

// A heartbeat keeps proxies (Vercel, Render) from closing a quiet stream.
const HEARTBEAT_MS = 25_000;

@Controller('events')
@UseGuards(SessionAuthGuard)
export class EventsController {
  constructor(private readonly realtime: RealtimeService) {}

  // GET /events/stream → Server-Sent Events: "requests" / "rides" hints for this user's role
  @Sse('stream')
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  stream(@CurrentUser() user: PublicUser): Observable<MessageEvent> {
    const mine = topicsFor(user.role);
    const changes = this.realtime.stream.pipe(
      map((topics) => topics.filter((topic) => mine.includes(topic))),
      filter((topics) => topics.length > 0),
      map((topics): MessageEvent => ({ type: 'change', data: { topics } })),
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    return merge(changes, heartbeat);
  }
}
