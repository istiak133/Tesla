import { Injectable } from '@nestjs/common';
import {
  GeographyRepository,
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
}
