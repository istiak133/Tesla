import { firstValueFrom, take, toArray } from 'rxjs';
import { Role } from '../generated/prisma/client.js';
import { RealtimeService, topicsFor } from './realtime.service.js';

describe('live update hints (D-020)', () => {
  it('drivers hear about requests and rides; passengers only about rides', () => {
    expect(topicsFor(Role.DRIVER)).toEqual(['requests', 'rides']);
    expect(topicsFor(Role.PASSENGER)).toEqual(['rides']);
  });

  it('every subscriber gets every change, in order', async () => {
    const realtime = new RealtimeService();
    const first = firstValueFrom(realtime.stream.pipe(take(2), toArray()));
    const second = firstValueFrom(realtime.stream.pipe(take(2), toArray()));
    realtime.publish(['requests', 'rides']);
    realtime.publish(['rides']);
    const expected = [['requests', 'rides'], ['rides']];
    expect(await first).toEqual(expected);
    expect(await second).toEqual(expected);
  });
});
