import { RideStatus } from '../generated/prisma/client.js';
import {
  joinProblem,
  sharedAHop,
  tripStops,
  type PoolSnapshot,
  type Stop,
} from './route-plan.js';

// Jashim's route in the story, with zone codes as ids so the examples read like the docs.
const UTT_BSH: Stop[] = ['UTT', 'BAN', 'MOH', 'GL1', 'GL2', 'BSH'].map(
  (code, position) => ({ position, zoneId: code, name: code }),
);

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
        seats: 1,
      })?.message,
    ).toBe('Not on this route in this direction');
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
        seats: 1,
      })?.message,
    ).toBe('The car has already passed BAN');
  });

  it('R3: never more seats than the vehicle has', () => {
    expect(
      joinProblem(pool, UTT_BSH, {
        pickupZoneId: 'BAN',
        dropoffZoneId: 'MOH',
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
