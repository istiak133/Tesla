import { kmFromStart } from '../geography/dhaka-routes.js';
import {
  AGING_MINUTES,
  approachKm,
  newTripStart,
  orderWaitingList,
  rankJoinCandidates,
  stopOf,
  type JoinCandidate,
} from './matching.js';
import type { Stop } from './route-plan.js';

// Jashim's route with zone codes as ids: Uttara 0 km, Banani 12, Mohakhali 15,
// Gulshan 1 18, Gulshan 2 20, Bashundhara 24.
const CODES = ['UTT', 'BAN', 'MOH', 'GL1', 'GL2', 'BSH'];
const KM = kmFromStart(CODES);
const UTT_BSH: Stop[] = CODES.map((code, position) => ({
  position,
  zoneId: code,
  name: code,
  kmFromStart: KM[position],
}));
const trip = (
  pickupZoneId: string,
  dropoffZoneId: string,
  distanceKm: number,
) => ({
  pickupZoneId,
  dropoffZoneId,
  distanceKm,
});

describe('where the car is (D-014)', () => {
  it('finds the car’s stop on the route', () => {
    expect(stopOf(UTT_BSH, 'BAN')).toBe(1);
    expect(stopOf(UTT_BSH, 'M10')).toBeNull();
    expect(stopOf(UTT_BSH, null)).toBeNull();
  });

  it('measures the drive to a pickup ahead, and refuses one behind', () => {
    expect(approachKm(UTT_BSH, 1, 2)).toBe(3); // Banani → Mohakhali
    expect(approachKm(UTT_BSH, 1, 1)).toBe(0); // already there
    expect(approachKm(UTT_BSH, 2, 1)).toBeNull(); // Banani is behind a car at Mohakhali
  });
});

describe('a new trip starts where the car is (A)', () => {
  it('starts at the car’s stop, so the car drives to the pickup', () => {
    // Jashim at Banani takes a Mohakhali → Gulshan 1 rider.
    expect(newTripStart(UTT_BSH, 'BAN', trip('MOH', 'GL1', 3))).toEqual({
      startStop: 1,
    });
  });

  it('refuses a pickup behind the car: no empty drive backwards', () => {
    // Jashim finished at Bashundhara; an Uttara request is 24 km behind him.
    expect(newTripStart(UTT_BSH, 'BSH', trip('UTT', 'BAN', 12))).toEqual({
      problem: 'Behind your car (UTT)',
    });
  });

  it('refuses when the car is not on the route or its place is unknown', () => {
    const notHere = {
      problem: 'Your car is not on this route: set your location first',
    };
    expect(newTripStart(UTT_BSH, 'M10', trip('BAN', 'MOH', 3))).toEqual(
      notHere,
    );
    expect(newTripStart(UTT_BSH, null, trip('BAN', 'MOH', 3))).toEqual(notHere);
  });

  it('still applies the route rules first', () => {
    expect(newTripStart(UTT_BSH, 'UTT', trip('BAN', 'UTT', 12))).toEqual({
      problem: 'Not on this route in this direction',
    });
  });
});

describe('auto-join tries the nearest car first (B)', () => {
  const at = (
    poolId: string,
    currentStop: number,
    minutesAgo: number,
  ): JoinCandidate => ({
    poolId,
    vehicleId: `car-${poolId}`,
    createdAt: new Date(Date.UTC(2026, 8, 29, 8, 0) - minutesAgo * 60_000),
    currentStop,
    stops: UTT_BSH,
  });

  it('prefers the car closest to the pickup over the oldest trip', () => {
    const ranked = rankJoinCandidates(
      [at('old-at-uttara', 0, 30), at('new-at-banani', 1, 1)],
      trip('MOH', 'GL1', 3),
    );
    expect(ranked.map((c) => [c.poolId, c.approachKm])).toEqual([
      ['new-at-banani', 3],
      ['old-at-uttara', 15],
    ]);
  });

  it('breaks a tie by the older trip', () => {
    const ranked = rankJoinCandidates(
      [at('newer', 1, 1), at('older', 1, 10)],
      trip('MOH', 'GL1', 3),
    );
    expect(ranked.map((c) => c.poolId)).toEqual(['older', 'newer']);
  });

  it('leaves out cars that have passed the pickup', () => {
    const ranked = rankJoinCandidates(
      [at('passed', 3, 5), at('coming', 1, 5)],
      trip('MOH', 'BSH', 7),
    );
    expect(ranked.map((c) => c.poolId)).toEqual(['coming']);
  });
});

describe('a driver’s waiting list (C)', () => {
  const now = new Date(Date.UTC(2026, 8, 29, 8, 0));
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
  const req = (
    id: string,
    canAccept: boolean,
    km: number | null,
    waited: number,
  ) => ({
    id,
    canAccept,
    pickupKmAhead: km,
    requestedAt: minutesAgo(waited),
  });

  it('puts takeable, nearby pickups first', () => {
    const list = orderWaitingList(
      [req('far', true, 6, 1), req('near', true, 0, 0), req('mid', true, 3, 2)],
      now,
    );
    expect(list.map((r) => r.id)).toEqual(['near', 'mid', 'far']);
  });

  it(`lifts a request waiting ${AGING_MINUTES}+ minutes to the top, so no one waits for ever`, () => {
    const list = orderWaitingList(
      [req('near', true, 0, 0), req('far-but-old', true, 9, AGING_MINUTES)],
      now,
    );
    expect(list.map((r) => r.id)).toEqual(['far-but-old', 'near']);
  });

  it('shows requests the driver cannot take last, oldest first', () => {
    const list = orderWaitingList(
      [
        req('no-newer', false, null, 1),
        req('yes', true, 3, 0),
        req('no-older', false, null, 9),
      ],
      now,
    );
    expect(list.map((r) => r.id)).toEqual(['yes', 'no-older', 'no-newer']);
  });
});
