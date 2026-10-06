import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Role } from '../generated/prisma/client.js';

/**
 * What changed, as a hint only (decision D-020). A screen that gets a hint fetches its own
 * data again through the normal, authorised endpoints, so an event never carries anyone's
 * ride, fare or name.
 *   requests: the set of waiting requests changed (a new one, taken, cancelled);
 *   rides:    some ride or trip changed (a join, a stop action, a cancel, a match round).
 */
export type Topic = 'requests' | 'rides';

/** Drivers watch both; a passenger only needs to know when rides change. */
export function topicsFor(role: Role): Topic[] {
  return role === Role.DRIVER ? ['requests', 'rides'] : ['rides'];
}

/**
 * In-process publish/subscribe for live updates. One API instance (as on Render's free
 * tier) is enough; with several instances the same interface would be backed by
 * PostgreSQL LISTEN/NOTIFY or a Redis channel, so every instance hears every change.
 */
@Injectable()
export class RealtimeService implements BeforeApplicationShutdown {
  private readonly changes = new Subject<Topic[]>();
  private readonly closing = new Subject<void>();

  publish(topics: Topic[]): void {
    this.changes.next(topics);
  }

  get stream(): Observable<Topic[]> {
    return this.changes.asObservable();
  }

  /** Emits once when the app starts shutting down: open streams end on it. */
  get shutdown(): Observable<void> {
    return this.closing.asObservable();
  }

  // An open stream never ends by itself (its heartbeat keeps it going), and the HTTP server
  // waits for every open response before it closes. So end the streams first; browsers
  // reconnect to the next instance.
  beforeApplicationShutdown(): void {
    this.closing.next();
    this.closing.complete();
  }
}
