import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthReport, HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // GET /health
  @Get()
  async getHealth(): Promise<HealthReport> {
    const report = await this.healthService.check();

    if (report.status !== 'ok') {
      // 503 tells Docker and the hosting platform that the app is not healthy.
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
