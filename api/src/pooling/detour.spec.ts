import { DISTANCE_KM, ZONES } from '../geography/dhaka-zones.js';
import { allDetoursWithinLimit, detoursKm, type Rider } from './detour.js';

// Use zone codes as ids so the examples read like the docs.
const indexOf = (code: string) => ZONES.findIndex((zone) => zone.code === code);
const distance = (from: string, to: string) =>
  DISTANCE_KM[indexOf(from)][indexOf(to)];

describe('detours (docs/assumptions.md §4.3)', () => {
  it('Nusrat (→ Mohakhali) and Rafiq (→ Gulshan 1) from Banani can share', () => {
    const riders: Rider[] = [
      { id: 'nusrat', dropoffZoneId: 'MOH' },
      { id: 'rafiq', dropoffZoneId: 'GL1' },
    ];

    const detours = detoursKm('BAN', riders, distance);

    // Nusrat: BAN → MOH = 3 km, direct 3 km → detour 0
    expect(detours.get('nusrat')).toBe(0);
    // Rafiq: BAN → MOH → GL1 = 3 + 3 = 6 km, direct 4 km → detour 2
    expect(detours.get('rafiq')).toBe(2);
    expect(allDetoursWithinLimit('BAN', riders, distance)).toBe(true);
  });

  it('a Banani → Uttara rider cannot join Nusrat (detour 4 km > 2 km)', () => {
    const riders: Rider[] = [
      { id: 'nusrat', dropoffZoneId: 'MOH' },
      { id: 'uttara', dropoffZoneId: 'UTT' },
    ];

    // BAN → MOH → UTT = 3 + 13 = 16 km, direct 12 km → detour 4
    expect(detoursKm('BAN', riders, distance).get('uttara')).toBe(4);
    expect(allDetoursWithinLimit('BAN', riders, distance)).toBe(false);
  });

  it('drops the nearest passenger first, whatever the request order', () => {
    // Rafiq asked first but Nusrat's stop is nearer, so Nusrat is dropped first.
    const riders: Rider[] = [
      { id: 'rafiq', dropoffZoneId: 'GL1' },
      { id: 'nusrat', dropoffZoneId: 'MOH' },
    ];

    const detours = detoursKm('BAN', riders, distance);

    expect(detours.get('nusrat')).toBe(0);
    expect(detours.get('rafiq')).toBe(2);
  });

  it('two riders going to the same zone have no detour', () => {
    const riders: Rider[] = [
      { id: 'nusrat', dropoffZoneId: 'MOH' },
      { id: 'shirin', dropoffZoneId: 'MOH' },
    ];

    const detours = detoursKm('BAN', riders, distance);

    expect(detours.get('nusrat')).toBe(0);
    expect(detours.get('shirin')).toBe(0);
  });
});
