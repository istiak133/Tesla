import { routeDirections } from '../geography/dhaka-routes.js';
import type { Stop } from './route-plan.js';
import { rankRoutes, suggestedRoute } from './route-suggestion.js';

// The six seeded routes, with zone codes as ids so the examples read like the docs.
const ROUTES = routeDirections().map((route) => ({
  id: route.code,
  code: route.code,
  name: route.code,
  stops: route.stops.map((code, position): Stop => ({
    position,
    zoneId: code,
    name: code,
  })),
}));

const trip = (pickupZoneId: string, dropoffZoneId: string) => ({
  pickupZoneId,
  dropoffZoneId,
});

describe('route suggestion (docs/assumptions.md §4.6)', () => {
  it('suggests the route with the most riders waiting ahead of the car', () => {
    // Jashim is at Banani. Two riders want Dhanmondi, one wants Gulshan 1.
    const waiting = [
      trip('BAN', 'DHN'),
      trip('MOH', 'FRM'),
      trip('BAN', 'GL1'),
    ];

    const ranked = rankRoutes(ROUTES, 'BAN', waiting);

    expect(suggestedRoute(ranked)).toMatchObject({
      routeId: 'BAN-DHN',
      waitingAhead: 2,
    });
    expect(ranked.find((r) => r.routeId === 'UTT-BSH')?.waitingAhead).toBe(1);
  });

  it('does not count riders the car has already passed', () => {
    // On UTT-BSH, Uttara is behind a car at Banani.
    const ranked = rankRoutes(ROUTES, 'BAN', [trip('UTT', 'GL1')]);

    expect(ranked.find((r) => r.routeId === 'UTT-BSH')?.waitingAhead).toBe(0);
  });

  it('prefers routes that pass the car, even if another has more riders', () => {
    // Mirpur riders are on UTT-DHN, which does not pass Gulshan 2.
    const waiting = [
      trip('M12', 'M10'),
      trip('M11', 'MR1'),
      trip('GL2', 'BSH'),
    ];

    const ranked = rankRoutes(ROUTES, 'GL2', waiting);

    expect(suggestedRoute(ranked)?.routeId).toBe('UTT-BSH');
    expect(ranked.filter((r) => !r.passesYou).map((r) => r.routeId)).toContain(
      'UTT-DHN',
    );
  });

  it('still suggests a route through the car when nobody is waiting', () => {
    const ranked = rankRoutes(ROUTES, 'TEJ', []);

    // BAN-DHN and DHN-BAN both pass Tejgaon; the tie goes to the route code.
    expect(suggestedRoute(ranked)?.routeId).toBe('BAN-DHN');
  });

  it('suggests nothing while the car’s zone is unknown', () => {
    const ranked = rankRoutes(ROUTES, null, [trip('BAN', 'MOH')]);

    expect(suggestedRoute(ranked)).toBeNull();
    expect(ranked).toHaveLength(6);
  });
});
