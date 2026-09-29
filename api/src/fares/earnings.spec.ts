import { kmFromStart, routeDirections } from '../geography/dhaka-routes.js';
import { DISTANCE_KM, ZONES } from '../geography/dhaka-zones.js';
import {
  servesTrip,
  sharedAHop,
  tripStops,
  type Stop,
} from '../pooling/route-plan.js';
import { carriedKm, tripEarnings, type CarriedRider } from './earnings.js';
import { finalFarePaisa } from './fare.js';

// The six seeded routes, with zone codes as ids so the examples read like the docs.
const ROUTES = routeDirections().map((route) => {
  const km = kmFromStart(route.stops);
  const stops: Stop[] = route.stops.map((code, position) => ({
    position,
    zoneId: code,
    name: code,
    kmFromStart: km[position],
  }));
  return { code: route.code, stops };
});
const UTT_BSH = ROUTES.find((route) => route.code === 'UTT-BSH')!.stops;

const indexOf = (code: string) => ZONES.findIndex((zone) => zone.code === code);
const directKm = (from: string, to: string) =>
  DISTANCE_KM[indexOf(from)][indexOf(to)];

/** A rider on UTT-BSH with the fare the app would lock at drop-off. */
function rider(from: string, to: string, fare: number): CarriedRider {
  const positions = tripStops(UTT_BSH, {
    pickupZoneId: from,
    dropoffZoneId: to,
  })!;
  return { ...positions, farePaisa: fare };
}

describe('trip earnings (docs/assumptions.md §7.2)', () => {
  it('Nusrat alone: ৳75 collected, Jashim ৳50, platform ৳25', () => {
    // 3 km with a passenger × ৳10 + 1 pickup × ৳20 = ৳50
    expect(tripEarnings(UTT_BSH, [rider('BAN', 'MOH', 7500)])).toEqual({
      collectedPaisa: 7500,
      driverPaisa: 5000,
      platformPaisa: 2500,
    });
  });

  it('Nusrat and Rafiq: the discount comes from the second fare, not from Jashim', () => {
    // Banani → Mohakhali → Gulshan 1 = 6 km carried, 2 pickups: 6 × 10 + 2 × 20 = ৳100
    expect(
      tripEarnings(UTT_BSH, [
        rider('BAN', 'MOH', 6000),
        rider('BAN', 'GL1', 7200),
      ]),
    ).toEqual({
      collectedPaisa: 13200,
      driverPaisa: 10000,
      platformPaisa: 3200,
    });
  });

  it('the whole story: ৳240 collected, Jashim ৳180 (75%), platform ৳60', () => {
    // Banani → Bashundhara is 12 km with someone on board; 3 pickups.
    expect(
      tripEarnings(UTT_BSH, [
        rider('BAN', 'MOH', 6000),
        rider('BAN', 'GL1', 7200),
        rider('MOH', 'BSH', 10800),
      ]),
    ).toEqual({
      collectedPaisa: 24000,
      driverPaisa: 18000,
      platformPaisa: 6000,
    });
  });

  it('pays only for km with a passenger on board, each hop once', () => {
    // Nusrat and Rafiq share Banani → Mohakhali: those 3 km are paid once, not twice.
    expect(
      carriedKm(UTT_BSH, [rider('BAN', 'MOH', 0), rider('BAN', 'GL1', 0)]),
    ).toBe(6);
  });

  it('nobody loses money on any trip any route can sell, alone or shared', () => {
    let tripsChecked = 0;
    let smallestPlatformPaisa = Infinity;

    for (const route of ROUTES) {
      const stops = route.stops;
      // Every trip this route can sell (R1, including "not too far round").
      const segments: {
        pickupStop: number;
        dropoffStop: number;
        km: number;
      }[] = [];
      for (let from = 0; from < stops.length; from++) {
        for (let to = from + 1; to < stops.length; to++) {
          const km = directKm(stops[from].zoneId, stops[to].zoneId);
          const trip = {
            pickupZoneId: stops[from].zoneId,
            dropoffZoneId: stops[to].zoneId,
            distanceKm: km,
          };
          if (servesTrip(stops, trip)) {
            segments.push({ pickupStop: from, dropoffStop: to, km });
          }
        }
      }

      // Every group of 1 to 3 bookings of 1 to 3 seats that fits Bullet's 3 seats.
      const bookings = segments.flatMap((segment) =>
        [1, 2, 3].map((seats) => ({ ...segment, seats })),
      );
      const groups: (typeof bookings)[] = [];
      for (let a = 0; a < bookings.length; a++) {
        groups.push([bookings[a]]);
        for (let b = a; b < bookings.length; b++) {
          groups.push([bookings[a], bookings[b]]);
          for (let c = b; c < bookings.length; c++) {
            groups.push([bookings[a], bookings[b], bookings[c]]);
          }
        }
      }

      for (const group of groups) {
        const fitsInCar = stops.every((_, hop) => {
          let seats = 0;
          for (const booking of group) {
            if (booking.pickupStop <= hop && hop < booking.dropoffStop) {
              seats += booking.seats;
            }
          }
          return seats <= 3;
        });
        if (!fitsInCar) {
          continue;
        }

        const riders = group.map((booking, index) => {
          const others = group.filter((_, other) => other !== index);
          const shared = sharedAHop(booking, others);
          return {
            pickupStop: booking.pickupStop,
            dropoffStop: booking.dropoffStop,
            farePaisa: finalFarePaisa(booking.km, booking.seats, shared),
          };
        });
        const earnings = tripEarnings(stops, riders);
        smallestPlatformPaisa = Math.min(
          smallestPlatformPaisa,
          earnings.platformPaisa,
        );
        tripsChecked++;
      }
    }

    // The platform keeps at least ৳10 on every possible trip, and the driver is
    // paid by the km and the pickup, so the discount never reaches the driver.
    expect(tripsChecked).toBeGreaterThan(25_000); // every group on all six routes
    expect(smallestPlatformPaisa).toBeGreaterThanOrEqual(1000);
  });
});
