import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { DistanceLookup } from '../pooling/detour.js';

export type ZoneSummary = { id: string; code: string; name: string };

@Injectable()
export class GeographyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async listZones(): Promise<ZoneSummary[]> {
    return this.prisma.zone.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
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
