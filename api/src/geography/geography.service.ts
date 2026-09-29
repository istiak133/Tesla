import { Injectable } from '@nestjs/common';
import { GeographyRepository, ZoneSummary } from './geography.repository.js';

/**
 * Zones for the pickup and destination pickers.
 * Thin today, but it keeps the same controller → service → repository layering as every other feature.
 */
@Injectable()
export class GeographyService {
  constructor(private readonly geographyRepository: GeographyRepository) {}

  async listZones(): Promise<ZoneSummary[]> {
    return this.geographyRepository.listZones();
  }
}
