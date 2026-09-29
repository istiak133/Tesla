import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import type { RouteSummary, ZoneSummary } from './geography.repository.js';
import { GeographyService } from './geography.service.js';

// Public reference data: anyone can see where Tesla Pool drives.
@Controller()
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  // GET /zones → the list of zones for the pickup and destination pickers
  @Get('zones')
  async listZones(): Promise<ZoneSummary[]> {
    return this.geographyService.listZones();
  }

  // GET /zones/:id/destinations → where a passenger can ride from this pickup
  @Get('zones/:id/destinations')
  async listDestinations(
    @Param('id', ParseUUIDPipe) pickupZoneId: string,
  ): Promise<ZoneSummary[]> {
    return this.geographyService.listDestinations(pickupZoneId);
  }

  // GET /routes → every route with its stops in driving order
  @Get('routes')
  async listRoutes(): Promise<RouteSummary[]> {
    return this.geographyService.listRoutes();
  }
}
