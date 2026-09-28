import { Injectable } from '@nestjs/common';
import { HealthRepository } from './health.repository.js';

export type HealthReport = {
  status: 'ok' | 'error';
  database: 'up' | 'down';
};

@Injectable()
export class HealthService {
  constructor(private readonly healthRepository: HealthRepository) {}

  async check(): Promise<HealthReport> {
    const databaseIsUp = await this.healthRepository.isDatabaseReachable();

    if (databaseIsUp) {
      return { status: 'ok', database: 'up' };
    }
    return { status: 'error', database: 'down' };
  }
}
