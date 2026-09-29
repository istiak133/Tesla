import { ZONES } from './dhaka-zones.js';
import { routeDirections } from './dhaka-routes.js';

describe('Dhaka routes', () => {
  const zoneCodes: string[] = ZONES.map((zone) => zone.code);
  const routes = routeDirections();

  it('has both directions of every line', () => {
    expect(routes.map((route) => route.code)).toEqual([
      'UTT-BSH',
      'BSH-UTT',
      'UTT-DHN',
      'DHN-UTT',
      'BAN-DHN',
      'DHN-BAN',
    ]);
  });

  it('only uses known zones, each at most once per route', () => {
    for (const route of routes) {
      for (const code of route.stops) {
        expect(zoneCodes).toContain(code);
      }
      expect(new Set(route.stops).size).toBe(route.stops.length);
    }
  });

  it('reaches every zone', () => {
    const served = new Set(routes.flatMap((route) => route.stops));
    expect([...served].sort()).toEqual([...zoneCodes].sort());
  });

  it('serves the story: Banani → Mohakhali → Gulshan 1 on UTT-BSH', () => {
    const route = routes.find((r) => r.code === 'UTT-BSH')!;
    expect(route.stops.indexOf('BAN')).toBeLessThan(route.stops.indexOf('MOH'));
    expect(route.stops.indexOf('MOH')).toBeLessThan(route.stops.indexOf('GL1'));
  });
});
