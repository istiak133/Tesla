import { kmFromStart } from '../geography/dhaka-routes.js';
import { RideStatus } from '../generated/prisma/client.js';
import {
  joinProblem,
  routeProblem,
  sharedAHop,
  tripStops,
  type PoolSnapshot,
  type Stop,
} from './route-plan.js';

// Jashim's route in the story, with zone codes as ids so the examples read like the docs.
const CODES = ['UTT', 'BAN', 'MOH', 'GL1', 'GL2', 'BSH'];
const KM = kmFromStart(CODES); // 0, 12, 15, 18, 20, 24
const UTT_BSH: Stop[] = CODES.map((code, position) => ({
  position,
  zoneId: code,
  name: code,
  kmFromStart: KM[position],
}));

// Bullet heading to Banani (position 1) with one of its three seats taken.
const pool: PoolSnapshot = {
  status: RideStatus.MATCHED,
  currentStop: 1,
  seatCapacity: 3,
  seatsTaken: 1,
};

describe('route rules (docs/assumptions.md §4)', () => {
  it('finds the stops of a trip on the route', () => {
    expect(
      tripStops(UTT_BSH, { pickupZoneId: 'BAN', dropoffZoneId: 'GL1' }),
    ).toEqual({ pickupStop: 1, dropoffStop: 3 });
  });

  it('R1: a trip against the direction of the route is not served', () => {
    expect(
      tripStops(UTT_BSH, { pickupZoneId: 'BAN', dropoffZoneId: 'UTT' }),
    ).toBeNull();
    expect(
      joinProblem(pool, UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'UTT',
        distanceKm: 12,
        seats: 1,
      })?.message,
    ).toBe('Not on this route in this direction');
  });

  it('R1: Rafiq may ride 2 km more than his direct distance', () => {
    // Banani → Mohakhali → Gulshan 1 = 3 + 3 = 6 km for a 4 km trip: +2 km is allowed.
    expect(
      routeProblem(UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'GL1',
        distanceKm: 4,
      }),
    ).toBeNull();
  });

  it('R1: a route that goes too far round does not sell the trip', () => {
    // Uttara → Bashundhara through Banani and Gulshan is 24 km for a 9 km trip.
    expect(
      routeProblem(UTT_BSH, {
        pickupZoneId: 'UTT',
        dropoffZoneId: 'BSH',
        distanceKm: 9,
      }),
    ).toBe('This route goes too far round (24 km for a 9 km trip)');
  });

  it('R1: on longer trips up to 40% more is allowed', () => {
    // Uttara → Mohakhali: 15 km on the route for 13 km direct (+2 km, 115%).
    expect(
      routeProblem(UTT_BSH, {
        pickupZoneId: 'UTT',
        dropoffZoneId: 'MOH',
        distanceKm: 13,
      }),
    ).toBeNull();
  });

  it('R1: a trip to a zone the route never visits is not served', () => {
    expect(
      tripStops(UTT_BSH, { pickupZoneId: 'BAN', dropoffZoneId: 'DHN' }),
    ).toBeNull();
  });

  it('Rafiq (Banani → Gulshan 1) can join Nusrat at Banani', () => {
    expect(
      joinProblem(pool, UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'GL1',
        distanceKm: 4,
        seats: 1,
      }),
    ).toBeNull();
  });

  it('R2: a passenger at a stop ahead can join a trip that has started', () => {
    const onTheWay = { ...pool, status: RideStatus.STARTED, currentStop: 2 };
    expect(
      joinProblem(onTheWay, UTT_BSH, {
        pickupZoneId: 'MOH',
        dropoffZoneId: 'BSH',
        distanceKm: 7,
        seats: 1,
      }),
    ).toBeNull();
  });

  it('R2: a stop the car has already passed is refused', () => {
    const onTheWay = { ...pool, status: RideStatus.STARTED, currentStop: 2 };
    expect(
      joinProblem(onTheWay, UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'GL1',
        distanceKm: 4,
        seats: 1,
      })?.message,
    ).toBe('The car has already passed BAN');
  });

  it('R3: never more seats than the vehicle has', () => {
    expect(
      joinProblem(pool, UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'MOH',
        distanceKm: 3,
        seats: 3,
      })?.message,
    ).toBe('1 seat(s) short');
  });

  it('R4: a finished trip takes nobody', () => {
    const done = { ...pool, status: RideStatus.COMPLETED };
    expect(
      joinProblem(done, UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'MOH',
        distanceKm: 3,
        seats: 1,
      })?.message,
    ).toBe('This trip has already ended');
  });
});

describe('the sharing rule for the discount', () => {
  const nusrat = { pickupStop: 1, dropoffStop: 2 }; // Banani → Mohakhali
  const rafiq = { pickupStop: 1, dropoffStop: 3 }; // Banani → Gulshan 1

  it('Nusrat and Rafiq share the Banani → Mohakhali hop', () => {
    expect(sharedAHop(nusrat, [rafiq])).toBe(true);
    expect(sharedAHop(rafiq, [nusrat])).toBe(true);
  });

  it('getting on where someone else gets off is not sharing', () => {
    const shirin = { pickupStop: 2, dropoffStop: 3 }; // Mohakhali → Gulshan 1
    expect(sharedAHop(nusrat, [shirin])).toBe(false);
    expect(sharedAHop(shirin, [nusrat])).toBe(false);
  });

  it('riding alone is not sharing', () => {
    expect(sharedAHop(nusrat, [])).toBe(false);
  });
});
