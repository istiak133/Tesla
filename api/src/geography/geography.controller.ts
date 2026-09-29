import { Controller, Get } from '@nestjs/common';
import type { ZoneSummary } from './geography.repository.js';
import { GeographyService } from './geography.service.js';

@Controller('zones')
export class GeographyController {
  constructor(private readonly geographyService: GeographyService) {}

  // GET /zones → the list of zones for the pickup and destination pickers
  @Get()
  async listZones(): Promise<ZoneSummary[]> {
    return this.geographyService.listZones();
  }
}
