import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import { Role } from '../generated/prisma/client.js';

/**
 * What changed, as a hint only (decision D-020). A screen that gets a hint fetches its own
 * data again through the normal, authorised endpoints, so an event never carries anyone's
 * ride, fare or name.
 *   requests: the set of waiting requests changed (a new one, taken, cancelled);
 *   rides:    some ride or trip changed (a join, a stop action, a cancel, a refill).
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
export class RealtimeService {
  private readonly changes = new Subject<Topic[]>();

  publish(topics: Topic[]): void {
    this.changes.next(topics);
  }

  get stream(): Observable<Topic[]> {
    return this.changes.asObservable();
  }
}
