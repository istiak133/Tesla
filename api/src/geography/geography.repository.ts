import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { Stop } from '../pooling/route-plan.js';

export type ZoneSummary = { id: string; code: string; name: string };

// Returns km between two zones (0 for the same zone).
export type DistanceLookup = (fromZoneId: string, toZoneId: string) => number;

export type RouteSummary = {
  id: string;
  code: string;
  name: string;
  stops: { position: number; zone: ZoneSummary }[];
};

@Injectable()
export class GeographyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listZones(): Promise<ZoneSummary[]> {
    return this.prisma.zone.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Every route with its stops in driving order. Six small routes, so no paging. */
  async listRoutes(): Promise<RouteSummary[]> {
    return this.prisma.route.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        stops: {
          orderBy: { position: 'asc' },
          select: {
            position: true,
            zone: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }

  async zoneExists(zoneId: string): Promise<boolean> {
    const zone = await this.prisma.zone.findUnique({ where: { id: zoneId } });
    return zone !== null;
  }

  /**
   * Loads the whole distance table (14 × 13 rows) once and returns a lookup function.
   * The same zone is 0 km.
   */
  async loadDistanceLookup(): Promise<DistanceLookup> {
    const rows = await this.prisma.zoneDistance.findMany();

    const kmByPair = new Map<string, number>();
    for (const row of rows) {
      kmByPair.set(`${row.fromZoneId}:${row.toZoneId}`, row.km);
    }

    return (fromZoneId: string, toZoneId: string): number => {
      if (fromZoneId === toZoneId) {
        return 0;
      }
      const km = kmByPair.get(`${fromZoneId}:${toZoneId}`);
      if (km === undefined) {
        throw new Error(
          `No distance between zones ${fromZoneId} and ${toZoneId}`,
        );
      }
      return km;
    };
  }
}

/** A route's stops in the shape the pooling rules use. */
export function toStops(route: RouteSummary): Stop[] {
  return route.stops.map((stop) => ({
    position: stop.position,
    zoneId: stop.zone.id,
    name: stop.zone.name,
  }));
}
