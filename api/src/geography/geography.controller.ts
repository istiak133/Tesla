import { Controller, Get } from '@nestjs/common';
import { GeographyRepository, ZoneSummary } from './geography.repository.js';

@Controller('zones')
export class GeographyController {
  constructor(private readonly geographyRepository: GeographyRepository) {}

  // GET /zones → the list of zones for the pickup and destination pickers
  @Get()
  async listZones(): Promise<ZoneSummary[]> {
    return this.geographyRepository.listZones();
  }
}
