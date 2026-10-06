import {
  Controller,
  Header,
  MessageEvent,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { filter, interval, map, merge, Observable, takeUntil, tap } from 'rxjs';
import type { PublicUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard.js';
import { Role } from '../generated/prisma/client.js';
import { RidesRepository } from '../rides/rides.repository.js';
import { RealtimeService, topicsFor } from './realtime.service.js';

// A heartbeat keeps proxies (Vercel, Render) from closing a quiet stream.
const HEARTBEAT_MS = 25_000;

@Controller('events')
@UseGuards(SessionAuthGuard)
export class EventsController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly ridesRepository: RidesRepository,
  ) {}

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
    // A driver's open stream counts as the app being there (also in a background tab, where
    // polling pauses): seen now, and again at every heartbeat until the stream closes.
    const seen = () => {
      if (user.role === Role.DRIVER) {
        this.ridesRepository
          .touchDriver(user.id, new Date())
          .catch(() => undefined); // presence is best effort; the next beat tries again
      }
    };
    seen();
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      tap(seen),
      map((): MessageEvent => ({ type: 'ping', data: {} })),
    );
    // Ends when the app shuts down, so the HTTP server can close (see RealtimeService).
    return merge(changes, heartbeat).pipe(takeUntil(this.realtime.shutdown));
  }
}
