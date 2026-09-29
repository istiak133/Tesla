import { Injectable, NotFoundException } from '@nestjs/common';
import { servesTrip } from '../pooling/route-plan.js';
import {
  GeographyRepository,
  toStops,
  type RouteSummary,
  type ZoneSummary,
} from './geography.repository.js';

@Injectable()
export class GeographyService {
  constructor(private readonly geographyRepository: GeographyRepository) {}

  async listZones(): Promise<ZoneSummary[]> {
    return this.geographyRepository.listZones();
  }

  async listRoutes(): Promise<RouteSummary[]> {
    return this.geographyRepository.listRoutes();
  }

  /**
   * The zones a passenger can ride to from this pickup: some route carries the trip
   * without going too far round (docs/assumptions.md §3.3). Used by the request form.
   */
  async listDestinations(pickupZoneId: string): Promise<ZoneSummary[]> {
    if (!(await this.geographyRepository.zoneExists(pickupZoneId))) {
      throw new NotFoundException('Zone not found');
    }
    const routes = await this.geographyRepository.listRoutes();
    const distance = await this.geographyRepository.loadDistanceLookup();

    const reachable = new Map<string, ZoneSummary>();
    for (const route of routes) {
      const stops = toStops(route);
      for (const stop of route.stops) {
        const trip = {
          pickupZoneId,
          dropoffZoneId: stop.zone.id,
          distanceKm: distance(pickupZoneId, stop.zone.id),
        };
        if (servesTrip(stops, trip)) {
          reachable.set(stop.zone.id, stop.zone);
        }
      }
    }
    return [...reachable.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
}
